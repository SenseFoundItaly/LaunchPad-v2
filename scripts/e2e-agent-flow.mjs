#!/usr/bin/env node
/**
 * Naive e2e: mimics one agent turn end-to-end against the running dev server.
 *
 *   chat  → POST /api/chat (real LLM call), expects a workflow-card artifact
 *           that gets parsed + captured into pending_actions
 *   signal→ direct INSERT into ecosystem_alerts (the monitor producer path is
 *           a separate cron job; we just want the signals API to surface it)
 *   approve→ GET /approvals, then POST /actions/[id] transition=apply, expect
 *           workflow_step handler to push state pending → applied → sent
 *
 * Prereqs:
 *   1. `npm run dev` running on http://localhost:3000
 *   2. dev server started with E2E_AUTH_ENABLED=1 in its env so the bypass
 *      in src/lib/auth/require-user.ts is honored
 *   3. .env.local has DATABASE_URL + OPENROUTER_API_KEY (or ANTHROPIC_API_KEY)
 *
 * Usage:
 *   E2E_AUTH_ENABLED=1 npm run dev          # in one terminal
 *   node scripts/e2e-agent-flow.mjs         # in another
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import postgres from 'postgres';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const STATE_FILE = path.join(process.cwd(), 'data', '.e2e-state.json');
const CHAT_TIMEOUT_MS = 180_000;
// 240s — tighter than the server's 300s. If a turn exceeds this, it's
// almost certainly an agent-stuck-in-loop case (we've seen turns hang to
// 10min when pi-agent-core's abort doesn't propagate through the SSE
// stream). Better to fail one turn fast than wait 6+ min.
const SKILL_TIMEOUT_MS = 240_000;

// Load .env.local so DATABASE_URL is available without --env-file
function loadDotEnvLocal() {
  const p = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnvLocal();

// ---------------------------------------------------------------------------
// Tiny test runner — no deps, just print PASS/FAIL with timing.
// ---------------------------------------------------------------------------
const steps = [];
function step(name, fn) { steps.push({ name, fn }); }
async function run() {
  let failed = 0;
  for (const s of steps) {
    const t = Date.now();
    process.stdout.write(`[${s.name.padEnd(28)}] `);
    try {
      await s.fn();
      console.log(`OK  (${Date.now() - t}ms)`);
    } catch (err) {
      failed++;
      console.log(`FAIL (${Date.now() - t}ms)`);
      // Truncate the error message — full HTML 404 bodies (and other
      // pathological pages) make the per-step log unreadable otherwise.
      const msg = err.message.length > 240 ? `${err.message.slice(0, 240)}…` : err.message;
      console.error(`  └─ ${msg}`);
      if (err.cause) console.error(`     cause: ${err.cause}`);
      // Continue to the next step instead of bailing — one stale assertion
      // shouldn't block downstream smarcamento + cost steps from running.
      continue;
    }
  }
  const total = steps.length;
  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${total - failed}/${total} steps`);
  if (_sql) await _sql.end({ timeout: 5 });
  process.exit(failed === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Test state — persisted across runs so the same shadow user is reused.
// ---------------------------------------------------------------------------
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return {}; }
}
function saveState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

const state = loadState();
state.userId ??= crypto.randomUUID();
saveState(state);

// ---------------------------------------------------------------------------
// HTTP helpers — every request carries the e2e auth header.
// ---------------------------------------------------------------------------
async function api(method, pathStr, body) {
  const res = await fetch(`${BASE_URL}${pathStr}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-e2e-user': state.userId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-json (e.g. SSE) */ }
  if (!res.ok) {
    const msg = json?.error || json?.message || text || `${res.status} ${res.statusText}`;
    throw new Error(`${method} ${pathStr} → ${res.status}: ${msg}`);
  }
  // Most routes wrap with `json()` helper → { success: true, data: X }.
  // /api/me + a few legacy routes return the payload directly. Unwrap when
  // we see the envelope so callers always see the inner shape.
  if (json && typeof json === 'object' && json.success === true && 'data' in json) {
    return json.data;
  }
  return json;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

// Single shared DB handle for the synthetic-alert insert + cleanup steps.
// Opened lazily so steps that don't touch the DB stay zero-dep.
let _sql = null;
function db() {
  if (!_sql) _sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  return _sql;
}

step('verify dev server up', async () => {
  const res = await fetch(`${BASE_URL}/api/health`);
  if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
});

step('purge prior test projects', async () => {
  // ON DELETE CASCADE on projects.id propagates to monitors, ecosystem_alerts,
  // pending_actions, workflow_plans, chat_messages — everything we touch.
  const sql = db();
  const rows = await sql`
    DELETE FROM projects
    WHERE owner_user_id = ${state.userId}
    RETURNING id
  `;
  if (rows.length > 0) console.log(`\n  purged ${rows.length} stale test project(s)`);
  // Any prior projectId in state is now stale — drop it.
  state.projectId = null;
  state.approvalId = null;
  saveState(state);
});

step('verify auth bypass enabled', async () => {
  // /api/me 401s unless requireUser succeeds. With E2E_AUTH_ENABLED off, our
  // x-e2e-user header is ignored and we'd hit Supabase auth.getUser() → 401.
  const me = await api('GET', '/api/me');
  if (me.userId !== state.userId) {
    throw new Error(`expected userId=${state.userId}, got ${me.userId}`);
  }
});

step('create project', async () => {
  const project = await api('POST', '/api/projects', {
    name: `E2E ${new Date().toISOString().slice(0, 16)}`,
    description: 'naive e2e flow: chat → signals → approvals',
    locale: 'en',
  });
  // POST /api/projects → json(mapProject(row)) → row.id renamed to project_id.
  const projectId = project?.project_id || project?.id;
  if (!projectId) throw new Error(`no project id in response: ${JSON.stringify(project)}`);
  state.projectId = projectId;
  saveState(state);
});

step('chat: workflow-card artifact', async () => {
  // Explicit ask — tilts the LLM toward emitting a workflow-card we can
  // capture. Without this, Sonnet/Opus might respond with prose only.
  const prompt = [
    'Briefly propose a 3-step workflow to validate this idea over the next week.',
    'You MUST emit it as a :::artifact{"type":"workflow-card"} block with',
    '"title", "description", "category":"validation", "priority":"high",',
    'and a "steps" array of exactly 3 short strings. Include a single web',
    'source in the "sources" array. Keep prose to one sentence.',
  ].join(' ');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAT_TIMEOUT_MS);

  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-e2e-user': state.userId,
    },
    body: JSON.stringify({
      project_id: state.projectId,
      step: 'chat',
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: ctrl.signal,
  });
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`/api/chat returned ${res.status}: ${await res.text()}`);
  }

  // Drain SSE so the route's flush hook completes (captureWorkflow runs there).
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sawDone = false;
  let donePayload = null;
  let fullText = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (typeof payload.content === 'string') fullText += payload.content;
        if (payload.done) { sawDone = true; donePayload = payload; }
      } catch { /* non-JSON SSE line */ }
    }
  }
  clearTimeout(timer);

  if (!sawDone) throw new Error('SSE stream closed without `done` event');
  if (!/:::artifact[\s\S]*workflow-card/.test(fullText)) {
    // Not fatal — the next step asserts the persisted pending_actions, which
    // is the real proof. But surfacing this here makes flakes easier to read.
    console.log(`\n  (warn) LLM did not emit a workflow-card artifact in prose.\n  Full text starts: ${fullText.slice(0, 200)}...`);
  }
  state.chatResponsePreview = fullText.slice(0, 300);
  state.chatResponseFull = fullText;
  state.chatDonePayload = donePayload;
  saveState(state);
});

// Mirrors src/types/artifacts.ts ARTIFACTS_REQUIRING_SOURCES — keep in sync.
// Out-of-sync isn't a correctness bug (server is the gate), just means the
// e2e under-reports drift, so prefer "stricter than server" if uncertain.
const FACTUAL_ARTIFACTS = new Set([
  'insight-card', 'comparison-table', 'action-suggestion', 'score-badge',
  'entity-card', 'workflow-card', 'radar-chart', 'bar-chart', 'pie-chart',
  'gauge-chart', 'score-card', 'metric-grid', 'fact', 'monitor-proposal',
  'budget-proposal',
]);

function parseArtifacts(text) {
  // Tolerant variant of src/lib/artifact-parser.tryParseArtifact — returns
  // {parsed, malformed} buckets so the eval can report on each.
  const blocks = [...text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)];
  const parsed = [];
  const malformed = [];
  for (const [raw, headerStr, bodyStr] of blocks) {
    try {
      const header = JSON.parse(headerStr);
      const body = JSON.parse(bodyStr.trim());
      parsed.push({ ...header, ...body });
    } catch (err) {
      malformed.push({ raw: raw.slice(0, 120), error: err.message });
    }
  }
  return { parsed, malformed };
}

step('chat quality: prose + artifacts', async () => {
  const text = state.chatResponseFull || '';
  const issues = [];

  // System prompt mandates plain text only.
  const prose = text
    .replace(/:::artifact[\s\S]*?:::/g, '')
    .replace(/<CITATIONS>[\s\S]*?<\/CITATIONS>/g, '');
  if (/\p{Extended_Pictographic}/u.test(prose)) issues.push('prose contains emoji');
  if (prose.trim().length === 0) issues.push('no visible prose (Tier 0: prose required)');

  const { parsed, malformed } = parseArtifacts(text);
  for (const m of malformed) issues.push(`malformed artifact JSON: ${m.error}`);
  if (parsed.length === 0) issues.push('no artifacts emitted');

  // Tier 0: every turn MUST end with a trailing option-set.
  const last = parsed[parsed.length - 1];
  if (!last || last.type !== 'option-set') {
    issues.push(`trailing option-set missing (last=${last?.type ?? 'none'})`);
  }

  // Workflow-card is the artifact we explicitly asked for — verify shape.
  const wf = parsed.find((a) => a.type === 'workflow-card');
  if (!wf) {
    issues.push('no workflow-card artifact');
  } else {
    if (!wf.title || typeof wf.title !== 'string') issues.push('workflow-card.title missing');
    if (!Array.isArray(wf.steps) || wf.steps.length === 0) {
      issues.push('workflow-card.steps[] missing or empty');
    } else if (wf.steps.some((s) => typeof s !== 'string' || !s.trim())) {
      issues.push('workflow-card has empty/non-string step');
    } else if (wf.steps.length < 3) {
      issues.push(`workflow-card.steps has ${wf.steps.length} steps, prompt asked for 3`);
    }
  }

  // Source enforcement — Tier 0 says every factual artifact MUST have sources.
  for (const a of parsed) {
    if (FACTUAL_ARTIFACTS.has(a.type)) {
      if (!Array.isArray(a.sources) || a.sources.length === 0) {
        issues.push(`${a.type} (id=${a.id ?? '?'}) missing sources[]`);
      } else {
        for (let i = 0; i < a.sources.length; i++) {
          const s = a.sources[i];
          if (!s || typeof s !== 'object' || typeof s.type !== 'string') {
            issues.push(`${a.type}.sources[${i}] malformed (no .type)`);
          } else if (s.type === 'web' && !s.url) {
            issues.push(`${a.type}.sources[${i}] is web but missing url`);
          }
        }
      }
    }
  }

  // Server enriches the SSE `done` event with persisted_artifacts for entity-
  // card / insight-card / score-card / etc. Workflow-cards take a different
  // path (captureWorkflow → pending_actions) and are intentionally absent
  // from persisted_artifacts — the approvals step below asserts that path.
  const persisted = state.chatDonePayload?.persisted_artifacts;
  const persistableFactualCount = parsed.filter(
    (a) => FACTUAL_ARTIFACTS.has(a.type) && a.type !== 'workflow-card' && a.type !== 'fact',
  ).length;
  if (persistableFactualCount > 0 && (!persisted || Object.keys(persisted).length === 0)) {
    issues.push('done event has no persisted_artifacts despite persistable factual artifacts');
  }

  console.log(`\n  artifacts: ${parsed.length} parsed (${parsed.map((a) => a.type).join(', ')})`);
  console.log(`  persisted: ${Object.keys(persisted ?? {}).length} server-side`);

  if (issues.length > 0) {
    throw new Error(`${issues.length} quality issue(s): ${issues.join('; ')}`);
  }
});

step('workflow-card persisted as workflow_plan', async () => {
  // Architecture as of Jun 4 2026: captureWorkflow() inserts the workflow-card
  // artifact directly into `workflow_plans` (status='proposed'). The old
  // pending_actions fan-out — one workflow_step row per step — was removed
  // because Apply on workflow_step was a no-op (graveyard). The artifact
  // renders inline in chat with its own progress UI; this step asserts the
  // plan row landed in the DB.
  //
  // Clear any stale state from a pre-Jun-4 run before asserting.
  state.workflowPlan = null;
  state.workflowPlanSteps = null;

  const plans = await db()`
    SELECT id, name, description, status, current_step,
           jsonb_typeof(steps) AS steps_jsonb_type,
           steps,
           jsonb_typeof(sources) AS sources_jsonb_type
      FROM workflow_plans WHERE project_id = ${state.projectId}
     ORDER BY created_at DESC LIMIT 1`;
  if (plans.length === 0) {
    throw new Error('no workflow_plans row for this project — captureWorkflow did not run');
  }
  const plan = plans[0];
  if (plan.status !== 'proposed') {
    throw new Error(`workflow_plans.status expected 'proposed', got '${plan.status}'`);
  }
  // Guard against the double-encoding bug fixed in migration 011 +
  // workflow-capture.ts. If a future commit re-introduces JSON.stringify on
  // the JSONB columns, steps_jsonb_type will be 'string' and this fails.
  if (plan.steps_jsonb_type !== 'array') {
    throw new Error(`workflow_plans.steps jsonb_typeof should be 'array', got '${plan.steps_jsonb_type}' (double-encoding regression — see workflow-capture.ts)`);
  }
  // postgres.js parses JSONB arrays to JS arrays automatically (no cast).
  const stepsArr = Array.isArray(plan.steps) ? plan.steps : [];
  if (stepsArr.length === 0) {
    throw new Error('workflow_plans.steps is an array but empty');
  }
  state.workflowPlan = { id: plan.id, name: plan.name, description: plan.description };
  state.workflowPlanSteps = stepsArr;
  saveState(state);
  console.log(`\n  workflow_plan "${plan.name}" — ${stepsArr.length} steps, jsonb_typeof=array ✓`);
});

step('no workflow_step fan-out in Inbox', async () => {
  // Inverse assertion: per finding_workflow_step_inbox_graveyard, the fan-out
  // was deliberately removed. If we see workflow_step rows for this project,
  // captureWorkflow regressed and is re-creating the graveyard.
  const rows = await db()`
    SELECT id FROM pending_actions
     WHERE project_id = ${state.projectId} AND action_type = 'workflow_step'`;
  if (rows.length > 0) {
    throw new Error(`expected 0 workflow_step pending_actions, found ${rows.length} (graveyard regression)`);
  }
  // Also assert workflow_plan stayed coherent: steps JSON shape, sources JSON
  // shape, name non-empty. These were quality checks on the old payload; same
  // intent, just against the persisted plan instead of fanned-out rows.
  if (!state.workflowPlan?.name) throw new Error('workflow_plan.name missing');
  const stepsArr = state.workflowPlanSteps || [];
  for (let i = 0; i < stepsArr.length; i++) {
    if (typeof stepsArr[i] !== 'string' || !stepsArr[i].trim()) {
      throw new Error(`workflow_plan.steps[${i}] empty or non-string`);
    }
  }
  console.log(`\n  workflow_plan "${state.workflowPlan.name}" (${stepsArr.length} steps), 0 graveyard rows ✓`);
});

step('workflow-card side effects: memory_fact + event', async () => {
  // captureWorkflow also writes a `decision` memory_fact ("Agent proposed
  // workflow X") and a `workflow_proposed` memory_event. These are the
  // cross-link plumbing the recent f431e7d commit relies on.
  const facts = await db()`
    SELECT id, fact, kind FROM memory_facts
     WHERE project_id = ${state.projectId} AND kind = 'decision'
       AND fact ILIKE '%workflow%'`;
  if (facts.length === 0) {
    throw new Error('expected a kind=decision memory_fact for the proposed workflow, found none');
  }
  const events = await db()`
    SELECT id, event_type FROM memory_events
     WHERE project_id = ${state.projectId} AND event_type = 'workflow_proposed'`;
  if (events.length === 0) {
    throw new Error('expected a workflow_proposed memory_event, found none');
  }
  console.log(`\n  memory_facts (decision): ${facts.length} · memory_events (workflow_proposed): ${events.length} ✓`);
});

step('teardown: delete project', async () => {
  await db()`DELETE FROM projects WHERE id = ${state.projectId}`;
  state.projectId = null;
  state.approvalId = null;
  saveState(state);
});

// ===========================================================================
// Smarcamento behavior eval — does the agent direct the founder across the
// 7 aspects of a business with research-backed validation? Smarcamento is
// an AGENT BEHAVIOR property in this codebase, not a state-machine property:
// the chat path doesn't write skill_completions rows (see project memory
// "finding-chat-skill-completions-gap"). So we test what the agent SHOULD do
// behaviorally per the system prompt's Tier 3 mandate ("every option-set
// MUST include AT LEAST ONE option that advances stage validation").
//
// What we check across N turns:
//   1. Every turn ends with a trailing option-set (Tier 0 mandate)
//   2. Across turns combined, the agent calls web_search >= 1x (research)
//   3. Across turns, factual artifacts cite web sources (data-backed)
//   4. Across turns, the agent references multiple of the 7 stage skills
//      (the canonical "all aspects" set in src/lib/stages.ts)
// ===========================================================================

// Keyword sets per stage — capture the SEMANTIC domain of each stage, not
// exact skill labels. The agent uses conversational phrasing ("Lean Canvas",
// "Research the market", "customer interviews") that diverges from the
// formal labels in STAGES[]. We match a turn against a STAGE when any of
// the stage's keywords appear in an option's label or description.
//
// Mirrors the seven aspects in src/lib/stages.ts. Tuning notes:
//   - "lean canvas" + "canvas" both map to Stage 1 (the idea-shaping skill
//     prompt explicitly says "Lean Canvas").
//   - "competitor" lands in Stage 2 (market validation) because competitive
//     mapping is part of market-research.
//   - "interview" lands in Stage 3 (persona) per the scientific-validation
//     skill scope.
// NB on word boundaries: prior versions used `\bfundrais\b` which matched
// NOTHING because "fundrais" isn't a word; ditto `interview question` vs
// the agent's actual "interview questions". Below: each alternative ends in
// either a word boundary OR an optional inflection that handles plurals
// (s?), verb forms ((?:e|ing)?), so the matcher catches what the agent
// actually says, not just textbook singulars.
const STAGE_KEYWORDS = [
  /* 1 */ [/\b(idea\s+canvas|lean\s+canvas|startup\s+score|score\s+(?:my|the)\s+idea|destructur(?:e|ing)|assumptions?|7-?stage)\b/i],
  /* 2 */ [/\b(market\s+(?:research|analysis|size|scan|landscape)|tam|sam|som|competitors?|competitive\s+(?:scan|analysis|landscape|gaps?)|research\s+the\s+market|gaps?\s+in\s+the\s+market|trends?)\b/i],
  /* 3 */ [/\b(personas?|buyer|empathy\s+maps?|customer\s+interviews?|(?:user\s+)?interview\s+(?:guide|questions?|script|plan)|cold\s+(?:dm|email|call)s?|risk\s+(?:audit|scoring)|painkiller|vitamin)\b/i],
  /* 4 */ [/\b(business\s+model|pricing|revenue\s+streams?|unit\s+economics|financial\s+(?:model|projections?)|projections?|llm\s+cost|cost\s+per\s+user)\b/i],
  /* 5 */ [/\b(mvp|prototype|tech\s+stack|landing\s+page|pitch\s+deck|one-?pager|gtm|go-?to-?market|growth\s+(?:loops?|experiments?)|launch|referral\s+(?:program|email)|reverse\s+trial)\b/i],
  /* 6 */ [/\b(fundrais(?:e|ing)|investors?|investment\s+readiness|data\s+room|pitch\s+(?:coach|coaching|deck)|investor\s+pipeline|seed\s+round|raise\s+(?:vs|now)|bootstrap)\b/i],
  /* 7 */ [/\b(weekly\s+metrics?|burn\s+rate|runway|operate|kpis?|metrics?\s+(?:dashboard|health|tracking|check|baseline)|churn|retention|cohort|leading\s+indicator|exit\s+survey)\b/i],
];
const STAGE_NAMES = ['Idea', 'Market', 'Persona', 'Business Model', 'Build & Launch', 'Fundraise', 'Operate'];

function stagesReferenced(text) {
  const hit = new Set();
  for (let i = 0; i < STAGE_KEYWORDS.length; i++) {
    if (STAGE_KEYWORDS[i].some((re) => re.test(text))) hit.add(i + 1);
  }
  return hit;
}

// Multi-turn script designed to test smarcamento across ALL 7 stages.
// Turns 1-3 are unbiased (test agent's natural direction on a fresh project).
// Turns 4-7 each contain a contextual cue targeting a specific later stage —
// if the agent still pushes Stage 1 work when asked about fundraising,
// smarcamento is broken for that aspect.
const TURNS = [
  { ask: 'I want to build something. Where do I start?',                                                          target: null },
  { ask: 'How do I know if anyone actually wants this?',                                                          target: null },
  { ask: 'What are the biggest risks I should worry about?',                                                      target: null },
  { ask: 'I have a working prototype already. How should I think about pricing and unit economics?',              target: 4 },
  { ask: 'I have 50 paying users at $25/mo. What is my go-to-market plan for scaling this?',                      target: 5 },
  { ask: 'I am thinking about raising a small seed round. What do I need in place to be investor-ready?',         target: 6 },
  { ask: 'We are launched and growing. What metrics should I track weekly to know if we are healthy?',            target: 7 },
];

async function runChatTurn(projectId, prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SKILL_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-e2e-user': state.userId },
      body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content: prompt }] }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`chat fetch failed: ${err.message}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`/api/chat ${res.status}: ${await res.text()}`);
  }
  const reader = res.body.getReader();
  // Crucial: AbortController.signal does NOT cancel an in-progress
  // reader.read() on a streaming Response.body. Hook the signal to call
  // reader.cancel() so the read() call returns instead of blocking forever.
  ctrl.signal.addEventListener('abort', () => {
    try { reader.cancel('client abort').catch(() => {}); } catch { /* ignore */ }
  }, { once: true });

  const dec = new TextDecoder();
  let buf = '', fullText = '', sawDone = false, donePayload = null;
  const toolsCalled = [];
  try {
    outer: while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const p = JSON.parse(line.slice(6));
          if (typeof p.content === 'string') fullText += p.content;
          if (p.tool_start?.name) toolsCalled.push(p.tool_start.name);
          if (p.done) {
            sawDone = true;
            donePayload = p;
            // Break out as soon as agent emits `done` — the chat route's
            // flush() hook (DB writes, artifact persistence) keeps the HTTP
            // response open after, but the agent has already finished. The
            // captured artifacts in the DB don't matter for client-side
            // analysis; we have the text. Cancel the reader to release
            // the connection so we don't wait for the flush.
            reader.cancel('client done').catch(() => {});
            break outer;
          }
        } catch { /* non-JSON SSE line */ }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  if (ctrl.signal.aborted) throw new Error('chat timed out client-side');
  if (!sawDone) throw new Error('SSE closed without done event');
  return { fullText, donePayload, toolsCalled };
}

step('smarcamento: create fresh project', async () => {
  const project = await api('POST', '/api/projects', {
    name: `E2E smarcamento ${new Date().toISOString().slice(0, 16)}`,
    description: 'I want to build an AI-powered email triage tool for indie SaaS founders who lose 2-3 hours/week to inbox sorting. Target: solo founders with $5k-50k MRR.',
    locale: 'en',
  });
  const projectId = project?.project_id || project?.id;
  if (!projectId) throw new Error(`no project id: ${JSON.stringify(project)}`);
  state.smarcamentoProjectId = projectId;
  saveState(state);
});

// Per-turn checks: every turn must (a) end with a trailing option-set and
// (b) have at least one option whose label references one of the 7-stage
// validation skills. Aggregate signals (web_search use, source diversity,
// stage coverage) get evaluated in the final step after all turns run.
const turnRecords = [];

for (let i = 0; i < TURNS.length; i++) {
  const turnNum = i + 1;
  const { ask: prompt, target } = TURNS[i];
  step(`smarcamento turn ${turnNum}${target ? ` →stage${target}` : ''}: run`, async () => {
    // SOFT per-turn step: records the turn's data and any violations into
    // turnRecords. Never throws — we want all turns to run so the aggregate
    // step at the end can judge across the whole conversation. The aggregate
    // is the hard gate.
    const pid = state.smarcamentoProjectId;
    const t0 = Date.now();
    let fullText = '';
    let toolsCalled = [];
    let donePayload = null;
    let turnTimedOut = false;
    try {
      const r = await runChatTurn(pid, prompt);
      fullText = r.fullText;
      toolsCalled = r.toolsCalled;
      donePayload = r.donePayload;
    } catch (err) {
      // Don't fail the whole test on a single-turn timeout/abort — record
      // as a soft violation, let the aggregate decide. Catches the known
      // "agent stuck in loop, abort doesn't propagate" pattern.
      turnTimedOut = true;
      console.log(`\n  turn ${turnNum} aborted: ${err.message}`);
    }
    const dt = Math.round((Date.now() - t0) / 1000);

    const { parsed } = parseArtifacts(fullText);
    const optionSet = parsed.find((a) => a.type === 'option-set');
    const violations = [];

    let optionStages = new Set();
    if (turnTimedOut) {
      violations.push(`turn aborted after ${dt}s`);
    } else if (!optionSet) {
      violations.push('no trailing option-set (Tier 0)');
    } else {
      const options = Array.isArray(optionSet.options) ? optionSet.options : [];
      const optionText = options
        .map((o) => `${o?.label ?? ''} ${o?.description ?? ''}`)
        .join(' || ');
      optionStages = stagesReferenced(optionText);
      if (optionStages.size === 0) {
        violations.push('option-set references no stage domain');
      }
      // If this turn explicitly targets a stage (the founder gave a contextual
      // cue, e.g. "I am raising a seed round" → expect Stage 6 in the CTAs),
      // missing that stage is a per-turn violation. Without this gate, the
      // agent could pass by pushing Stage 1 work on every prompt.
      if (target && !optionStages.has(target)) {
        violations.push(`target stage ${target}/${STAGE_NAMES[target - 1]} not referenced`);
      }
    }

    const cost = typeof donePayload?.usage?.cost === 'number' ? donePayload.usage.cost : 0;
    const credits = typeof donePayload?.usage?.credits === 'number' ? donePayload.usage.credits : 0;
    turnRecords.push({
      turn: turnNum,
      prompt,
      target,
      durationS: dt,
      cost,
      credits,
      tools: toolsCalled,
      artifacts: parsed.map((a) => ({
        type: a.type,
        sourceCount: Array.isArray(a.sources) ? a.sources.length : 0,
        webSourceCount: Array.isArray(a.sources) ? a.sources.filter((s) => s?.type === 'web').length : 0,
      })),
      optionLabels: optionSet ? optionSet.options.map((o) => String(o?.label ?? '')) : [],
      optionStages: [...optionStages],
      violations,
    });

    console.log(`\n  turn ${turnNum} (${dt}s, $${cost.toFixed(4)}): ${toolsCalled.length} tool calls (${[...new Set(toolsCalled)].join(', ') || 'none'}), ${parsed.length} artifact(s)`);
    if (optionSet) console.log(`  options: ${optionSet.options.map((o) => `"${o.label}"`).join(', ')}`);
    if (violations.length > 0) console.log(`  (soft) violations: ${violations.join('; ')}`);
  });
}

step('smarcamento: aggregate behavior eval', async () => {
  // Thresholds match the user's objective: "direct the founder to tackle
  // ALL aspects of a business and validate them with DATA and RESEARCH".
  // With 7 turns (3 unbiased + 4 stage-targeted), the bar is ALL 7 stages.
  const MIN_STAGE_COVERAGE = 7;        // of 7 — true "all aspects"
  const MIN_WEB_SEARCHES = 2;          // "research" plural
  // 33% floor — calibrated to observed LLM variance over 5 runs
  // (citation rates: 0%, 20%, 100%, 100%, 33%). In a 7-turn smarcamento
  // convo, many artifacts summarize the founder's own state (type:user /
  // type:internal sources, legitimately not web). A 33% floor catches a
  // 0% regression but accepts normal LLM stochasticity. The per-Tier-0
  // source enforcement in chat/route.ts is the real gate against
  // unsourced factual claims; this is a "did the agent cite ANYTHING
  // web" sanity check.
  const FACTUAL_SOURCE_FLOOR = 0.33;

  const issues = [];

  // (1) Direction: turns must have a trailing option-set with a stage CTA.
  // Tolerance: allow up to 1 turn to fail (typically a flaky agent-hang
  // case). Anything more = real direction regression.
  const turnsMissingDirection = turnRecords.filter((t) => t.violations.length > 0);
  if (turnsMissingDirection.length > 1) {
    issues.push(
      `${turnsMissingDirection.length}/${turnRecords.length} turn(s) failed direction check: ` +
      turnsMissingDirection.map((t) => `turn ${t.turn} (${t.violations.join(', ')})`).join('; '),
    );
  }

  // (2) Research-backed: agent invoked web_search at least MIN_WEB_SEARCHES
  //     times. Plural — one search across the whole convo isn't "research".
  const allTools = turnRecords.flatMap((t) => t.tools);
  const webSearchCount = allTools.filter((name) => /web_search|search_web|browse/i.test(name)).length;
  if (webSearchCount < MIN_WEB_SEARCHES) {
    issues.push(`only ${webSearchCount} web_search call(s) across ${turnRecords.length} turns (min ${MIN_WEB_SEARCHES} required for "research")`);
  }

  // (3) Data-backed: every factual artifact must cite a web source. Mirrors
  //     Tier 0 source-enforcement plus the user's "data" mandate.
  const allArtifacts = turnRecords.flatMap((t) => t.artifacts);
  const factualArtifacts = allArtifacts.filter((a) => FACTUAL_ARTIFACTS.has(a.type));
  const factualWithWebSource = factualArtifacts.filter((a) => a.webSourceCount > 0);
  const sourceRate = factualArtifacts.length === 0 ? 1 : factualWithWebSource.length / factualArtifacts.length;
  if (factualArtifacts.length === 0) {
    issues.push('no factual artifacts emitted across turns — agent gave prose-only answers without evidence-backed claims');
  } else if (sourceRate < FACTUAL_SOURCE_FLOOR) {
    issues.push(`only ${factualWithWebSource.length}/${factualArtifacts.length} factual artifacts cite web sources (${(sourceRate * 100).toFixed(0)}% < ${(FACTUAL_SOURCE_FLOOR * 100).toFixed(0)}%)`);
  }

  // (4) Stage coverage: across the conversation, the agent's option-sets
  //     touched MIN_STAGE_COVERAGE of the 7 stage domains. The user's
  //     objective is "ALL the aspects" — for 3 turns of vague prompts,
  //     4/7 is the honest interpretation.
  const stagesUnion = new Set();
  for (const t of turnRecords) for (const s of t.optionStages || []) stagesUnion.add(s);
  if (stagesUnion.size < MIN_STAGE_COVERAGE) {
    issues.push(`agent referenced ${stagesUnion.size} of 7 stage domains (min ${MIN_STAGE_COVERAGE} required for "all aspects")`);
  }

  // Per-stage coverage breakdown: which turns referenced each of the 7 stages.
  const stageCoverage = [];
  for (let s = 1; s <= 7; s++) {
    const turnsHit = turnRecords.filter((t) => (t.optionStages || []).includes(s)).map((t) => t.turn);
    stageCoverage.push({ stage: s, name: STAGE_NAMES[s - 1], hits: turnsHit });
  }
  const missingStages = stageCoverage.filter((s) => s.hits.length === 0);

  console.log(`\n  aggregate over ${turnRecords.length} turns:`);
  console.log(`    direction kept (option-set + stage CTA): ${turnRecords.length - turnsMissingDirection.length}/${turnRecords.length} turns`);
  console.log(`    web_search calls: ${webSearchCount} (min ${MIN_WEB_SEARCHES})`);
  console.log(`    factual artifacts with web sources: ${factualWithWebSource.length}/${factualArtifacts.length} (${(sourceRate * 100).toFixed(0)}%)`);
  console.log(`    stage coverage: ${stagesUnion.size}/7 (min ${MIN_STAGE_COVERAGE})`);
  for (const s of stageCoverage) {
    const mark = s.hits.length > 0 ? 'YES' : 'NO ';
    console.log(`      ${mark} ${s.stage}/${s.name.padEnd(16)} turns: [${s.hits.join(',') || '-'}]`);
  }

  if (issues.length > 0) throw new Error(`${issues.length} smarcamento gap(s): ${issues.join(' | ')}`);
});

step('cost report: SSE + llm_usage_logs + Langfuse', async () => {
  const pid = state.smarcamentoProjectId;
  if (!pid) { console.log('\n  (no smarcamento project to report on)'); return; }

  // (1) Per-turn cost from the SSE `done` event we captured.
  const sseTotal = turnRecords.reduce((s, t) => s + (t.cost || 0), 0);
  console.log(`\n  per-turn SSE cost:`);
  for (const t of turnRecords) {
    const flag = t.violations.length > 0 ? ' (flake)' : '';
    console.log(`    turn ${t.turn} (${t.durationS}s): $${(t.cost || 0).toFixed(4)}${flag}`);
  }
  console.log(`    SSE total: $${sseTotal.toFixed(4)}`);

  // (2) Server-side source of truth — llm_usage_logs table, populated by the
  //     chat route in src/app/api/chat/route.ts:476 (logUsageToSQLite). This
  //     covers EVERY agent invocation including skill_* tool internal calls,
  //     not just the chat turn the SSE done event reports on.
  const usage = await db()`
    SELECT step, provider, model, input_tokens, output_tokens, total_cost_usd, latency_ms, created_at
    FROM llm_usage_logs
    WHERE project_id = ${pid}
    ORDER BY created_at ASC
  `;
  const dbTotal = usage.reduce((s, r) => s + Number(r.total_cost_usd ?? 0), 0);
  const tokenTotal = usage.reduce(
    (s, r) => ({
      input: s.input + Number(r.input_tokens ?? 0),
      output: s.output + Number(r.output_tokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
  console.log(`\n  llm_usage_logs (server-side, all agent + skill calls):`);
  console.log(`    rows: ${usage.length} · total input tokens: ${tokenTotal.input.toLocaleString()} · output: ${tokenTotal.output.toLocaleString()}`);
  const byModel = {};
  for (const r of usage) {
    const k = `${r.provider}/${r.model}`;
    byModel[k] = (byModel[k] || 0) + Number(r.total_cost_usd ?? 0);
  }
  for (const [k, c] of Object.entries(byModel).sort(([, a], [, b]) => b - a)) {
    console.log(`      ${k.padEnd(45)} $${c.toFixed(4)}`);
  }
  console.log(`    DB total: $${dbTotal.toFixed(4)}`);

  // (3) Langfuse — every chat-route logUsageToSQLite call is paired with a
  //     logToLangfuse call (src/app/api/chat/route.ts:477). Traces are
  //     keyed by projectId — go to the dashboard and filter by userId=<pid>.
  const lfBase = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
  console.log(`\n  Langfuse tracking:`);
  if (process.env.LANGFUSE_PUBLIC_KEY) {
    console.log(`    ✓ LANGFUSE_* env vars set — every chat turn auto-logged`);
    console.log(`    Dashboard: ${lfBase}/project/<your-langfuse-project>/traces?userId=${pid}`);
    console.log(`    Filter on userId=${pid} to see exactly the ${usage.length} agent calls from this run`);
  } else {
    console.log(`    ✗ LANGFUSE_PUBLIC_KEY not set — chat route silently skipped Langfuse logging`);
  }

  state.costReport = {
    sse_total_usd: sseTotal,
    db_total_usd: dbTotal,
    db_rows: usage.length,
    input_tokens: tokenTotal.input,
    output_tokens: tokenTotal.output,
  };
  saveState(state);
});

// ──────────────────────────────────────────────────────────────────────────
// Gap-coverage steps for recent commits — added after the smarcamento eval.
// These run against the smarcamento project (state.smarcamentoProjectId)
// before teardown so we can lean on the rich data the 7 turns produced.
// ──────────────────────────────────────────────────────────────────────────

step('memory↔artifact cross-link plumbing (f431e7d)', async () => {
  // The recent commit cross-links Memory ↔ Artifact and IdeaCanvas → Memory
  // via memory_events (event_type) and memory_facts (source_type/source_id).
  // Assert that at least one fact has a source_id pointing at a chat message
  // or artifact id — that's what the cross-link UI keys off.
  const pid = state.smarcamentoProjectId;
  if (!pid) throw new Error('smarcamentoProjectId missing');
  const facts = await db()`
    SELECT COUNT(*)::int AS c, COUNT(source_id)::int AS with_src
      FROM memory_facts WHERE project_id = ${pid}`;
  if (facts[0].c === 0) {
    throw new Error('expected memory_facts from smarcamento turns, found none');
  }
  if (facts[0].with_src === 0) {
    throw new Error(`${facts[0].c} memory_facts but 0 with source_id — cross-link broken`);
  }
  console.log(`\n  memory_facts: ${facts[0].c} total, ${facts[0].with_src} carry source_id ✓`);
});

step('idea_canvas → memory_events trail (f431e7d)', async () => {
  // update_idea_canvas tool fired during smarcamento; idea_canvas is a single
  // row per project (PK on project_id) with wide columns (problem, solution,
  // target_market, business_model, etc). Count which columns are populated
  // as the "sections filled" signal.
  const pid = state.smarcamentoProjectId;
  const rows = await db()`
    SELECT problem IS NOT NULL AS f_problem,
           solution IS NOT NULL AS f_solution,
           target_market IS NOT NULL AS f_target,
           business_model IS NOT NULL AS f_bm,
           competitive_advantage IS NOT NULL AS f_ca,
           value_proposition IS NOT NULL AS f_vp,
           unfair_advantage IS NOT NULL AS f_ua
      FROM idea_canvas WHERE project_id = ${pid}`;
  const filled = rows[0]
    ? Object.entries(rows[0]).filter(([_, v]) => v === true).map(([k]) => k.replace(/^f_/, ''))
    : [];
  const events = await db()`
    SELECT event_type, COUNT(*)::int AS c FROM memory_events
     WHERE project_id = ${pid} GROUP BY event_type ORDER BY c DESC`;
  console.log(`\n  idea_canvas row: ${rows.length === 1 ? 'present' : 'absent'} (${filled.length} sections filled${filled.length ? ': ' + filled.join(', ') : ''})`);
  console.log(`  memory_events:`);
  for (const e of events) console.log(`    ${e.event_type.padEnd(28)} ${e.c}`);
  if (events.length === 0) {
    throw new Error('expected memory_events from chat turns, found none');
  }
});

step('skill kickoff endpoint reachable (69ed944)', async () => {
  // The click-to-start feature posts to /api/projects/:id/skills with
  // { skill_id } and expects a skill_completions row in 'pending' or
  // 'running'. Assert the route exists + responds, even if smarcamento turns
  // didn't already fire that exact skill_id.
  const pid = state.smarcamentoProjectId;
  // Probe with a known canonical skill_id from the stages module.
  const res = await fetch(`${BASE_URL}/api/projects/${pid}/skills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': state.userId },
    body: JSON.stringify({ skill_id: 'idea_shaping' }),
  });
  const body = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(body); } catch {}
  if (!res.ok) {
    throw new Error(`POST /skills returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const skills = await db()`
    SELECT id, skill_id, status FROM skill_completions
     WHERE project_id = ${pid} ORDER BY completed_at DESC LIMIT 5`;
  console.log(`\n  POST /skills idea_shaping → ${res.status} (${parsed?.success ? 'ok' : 'fail'})`);
  console.log(`  recent skill_completions: ${skills.length}`);
  for (const s of skills) console.log(`    ${s.skill_id.padEnd(20)} ${s.status}`);
  if (skills.length === 0) {
    throw new Error('POST /skills succeeded but no skill_completions row was created');
  }
});

step('sharing: shared user can read project (5c2e101 verify)', async () => {
  // Insert a second e2e user, share the smarcamento project with them, then
  // assert GET /api/projects/:id with the shared user's header returns 200.
  // This exercises tryProjectAccess(member) — the same path real shares hit.
  const pid = state.smarcamentoProjectId;
  const otherUserId = `${Date.now()}-share-target`;
  await db()`
    INSERT INTO users (id, email) VALUES (${otherUserId}, ${otherUserId + '@e2e.local'})
    ON CONFLICT (id) DO NOTHING`;
  const orgId = crypto.randomUUID();
  await db()`
    INSERT INTO organizations (id, name) VALUES (${orgId}, ${'share-test-org'})
    ON CONFLICT (id) DO NOTHING`;
  await db()`
    INSERT INTO memberships (id, user_id, org_id, role)
    VALUES (${crypto.randomUUID()}, ${otherUserId}, ${orgId}, 'owner')`;
  await db()`
    INSERT INTO project_members (id, project_id, user_id, role, added_by)
    VALUES (${'pm_' + crypto.randomUUID().slice(0, 12)}, ${pid}, ${otherUserId}, 'member', ${state.userId})`;

  // GET as the shared member
  const res = await fetch(`${BASE_URL}/api/projects/${pid}`, {
    headers: { 'x-e2e-user': otherUserId },
  });
  if (!res.ok) {
    throw new Error(`shared user got ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const body = await res.json();
  if (body?.data?.access_kind !== 'member') {
    throw new Error(`expected access_kind=member, got ${body?.data?.access_kind}`);
  }
  // Owner-only gate: DELETE must 403
  const del = await fetch(`${BASE_URL}/api/projects/${pid}`, {
    method: 'DELETE',
    headers: { 'x-e2e-user': otherUserId },
  });
  if (del.status !== 403) {
    throw new Error(`expected DELETE → 403 for shared member, got ${del.status}`);
  }
  console.log(`\n  shared user reads project (access_kind=member) ✓`);
  console.log(`  shared user DELETE → 403 ✓`);

  // Clean up the synthetic membership/user so a re-run doesn't accumulate.
  await db()`DELETE FROM project_members WHERE project_id = ${pid} AND user_id = ${otherUserId}`;
  await db()`DELETE FROM memberships WHERE user_id = ${otherUserId}`;
  await db()`DELETE FROM users WHERE id = ${otherUserId}`;
  await db()`DELETE FROM organizations WHERE id = ${orgId}`;
});

step('smarcamento: leave project for inspection', async () => {
  // SKIP teardown when E2E_KEEP_PROJECT=1 so the user can verify via UI/DB.
  if (process.env.E2E_KEEP_PROJECT === '1') {
    console.log(`\n  E2E_KEEP_PROJECT=1 — project ${state.smarcamentoProjectId} preserved`);
    console.log(`  Owner: ${state.userId}`);
    console.log(`  Login as the same Supabase user OR run a DB UPDATE to transfer owner_user_id to your account, then visit:`);
    console.log(`    http://localhost:3000/project/${state.smarcamentoProjectId}`);
    return;
  }
  await db()`DELETE FROM projects WHERE id = ${state.smarcamentoProjectId}`;
  state.smarcamentoProjectId = null;
  saveState(state);
});

run().catch(async (err) => {
  console.error('\nUnhandled:', err);
  if (_sql) await _sql.end({ timeout: 5 });
  process.exit(2);
});
