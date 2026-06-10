#!/usr/bin/env node
/**
 * Marketing-uncertainty smarcamento simulator (5 turns).
 * Founder: burning $500/mo on Google Ads, 0 conversions across 8 weeks,
 * $4.20 CPC, 78% bounce, tempted to triple budget. Product: personal finance
 * app for freelancers.
 *
 * Scores each turn (0-100) across 5 sub-scores (0-20 each):
 *   - spine awareness
 *   - signal/evidence usage
 *   - right tool (skill_marketing_audit / web_search / propose_monitor)
 *   - challenge / de-risk
 *   - next step quality
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3001';
const USER_ID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const TURN_TIMEOUT_MS = 240_000;

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

let _sql = null;
function db() { if (!_sql) _sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 }); return _sql; }

async function api(method, pathStr, body) {
  const res = await fetch(`${BASE_URL}${pathStr}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) throw new Error(`${method} ${pathStr} → ${res.status}: ${json?.error || text}`);
  if (json && typeof json === 'object' && json.success === true && 'data' in json) return json.data;
  return json;
}

// ---------- artifact parser ----------
function parseArtifacts(text) {
  const blocks = [...text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)];
  const parsed = [];
  for (const [, headerStr, bodyStr] of blocks) {
    try {
      parsed.push({ ...JSON.parse(headerStr), ...JSON.parse(bodyStr.trim()) });
    } catch {}
  }
  return parsed;
}

// ---------- chat turn ----------
async function runChatTurn(projectId, prompt, prevMessages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  const messages = [...prevMessages, { role: 'user', content: prompt }];
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
      body: JSON.stringify({ project_id: projectId, step: 'chat', messages }),
      signal: ctrl.signal,
    });
  } catch (err) { clearTimeout(timer); throw new Error(`chat fetch failed: ${err.message}`); }
  if (!res.ok) { clearTimeout(timer); throw new Error(`/api/chat ${res.status}: ${await res.text()}`); }

  const reader = res.body.getReader();
  ctrl.signal.addEventListener('abort', () => { try { reader.cancel('abort').catch(() => {}); } catch {} }, { once: true });
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
          if (p.done) { sawDone = true; donePayload = p; reader.cancel('done').catch(() => {}); break outer; }
        } catch {}
      }
    }
  } finally { clearTimeout(timer); }
  return { fullText, donePayload, toolsCalled, sawDone, aborted: ctrl.signal.aborted };
}

// ---------- scoring ----------
const SPINE_TERMS = /\b(stage|spine|seven|7-?stage|journey|aspect|smarcamento|funnel\s+(?:teardown|stage)|north[- ]?star|root[- ]?cause|hypothes(?:is|es)|assumption|diagnose|sequenc(?:e|ing)|order\s+of\s+operations)\b/i;
const EVIDENCE_TERMS = /\b(benchmark|industry\s+average|saas\s+(?:cac|conversion)|cpc|ctr|cvr|conversion\s+rate|bounce\s+rate|cac|ltv|payback|cohort|baseline|data|evidence|source|signal)\b/i;
const CHALLENGE_TERMS = /\b(do\s+not|don't|stop|pause|hold|before\s+(?:you|increasing|tripling|3x)|first\s+diagnose|root\s+cause|wasted?|burning|risk\s+of|premature|escalat(?:e|ing)|not\s+yet|push\s+back|disagree|reconsider|warn|caution|symptom\s+vs\b|treat\s+the\s+symptom)\b/i;
const NEXT_STEP_TERMS = /\b(today|this\s+week|next\s+(?:24|48|72)\s*hours?|step\s+1|first\s+step|run\s+(?:a|an|the)|test|interview|teardown|audit|measure|track|set\s+up|create|write|build)\b/i;

function scoreTurn({ fullText, toolsCalled, artifacts, optionSet, aborted, prompt }) {
  const text = fullText || '';
  const allText = text + ' ' + (optionSet ? JSON.stringify(optionSet.options ?? []) : '');

  if (aborted || !text) {
    return { spine: 0, evidence: 0, tool: 0, challenge: 0, nextStep: 0, total: 0, notes: ['aborted/empty'] };
  }

  // Spine awareness (0-20): refs to stages, root-cause sequencing, funnel teardown
  let spine = 0;
  const spineHits = (allText.match(SPINE_TERMS) || []).length;
  if (spineHits >= 1) spine += 8;
  if (spineHits >= 3) spine += 6;
  if (/funnel|teardown|root\s+cause|diagnose\s+before/i.test(allText)) spine += 6;
  spine = Math.min(20, spine);

  // Signal/evidence (0-20): citations, benchmarks, CAC/LTV math, sources[]
  let evidence = 0;
  const evHits = (allText.match(EVIDENCE_TERMS) || []).length;
  if (evHits >= 1) evidence += 5;
  if (evHits >= 3) evidence += 5;
  const factualArtifacts = artifacts.filter((a) =>
    ['insight-card','comparison-table','metric-grid','workflow-card','entity-card','score-card','fact','monitor-proposal'].includes(a.type)
  );
  const withWebSources = factualArtifacts.filter((a) => Array.isArray(a.sources) && a.sources.some((s) => s?.type === 'web'));
  if (withWebSources.length >= 1) evidence += 6;
  if (/\$\d|%|\d+\s*(?:bps|basis|cents)|cac|ltv/i.test(text)) evidence += 4;
  evidence = Math.min(20, evidence);

  // Right tool (0-20): skill_marketing_audit / web_search / propose_monitor
  let tool = 0;
  const uniq = new Set(toolsCalled);
  if (uniq.has('web_search')) tool += 8;
  if ([...uniq].some((t) => /marketing|audit|skill_marketing/i.test(t))) tool += 8;
  if ([...uniq].some((t) => /propose_monitor/i.test(t))) tool += 4;
  if (toolsCalled.length === 0) tool = Math.max(0, tool - 4);
  tool = Math.min(20, Math.max(0, tool));

  // Challenge / de-risk (0-20): push back on 3x budget, name "treating symptom not cause"
  let challenge = 0;
  const challengeHits = (text.match(CHALLENGE_TERMS) || []).length;
  if (challengeHits >= 1) challenge += 6;
  if (challengeHits >= 3) challenge += 6;
  if (/3x|triple|increase\s+(?:the\s+)?budget/i.test(text) && /(don't|do\s+not|before|first|pause|hold|risk)/i.test(text)) challenge += 8;
  challenge = Math.min(20, challenge);

  // Next step quality (0-20): concrete, time-boxed, testable
  let nextStep = 0;
  const nsHits = (text.match(NEXT_STEP_TERMS) || []).length;
  if (nsHits >= 2) nextStep += 6;
  if (optionSet && Array.isArray(optionSet.options) && optionSet.options.length >= 2) nextStep += 6;
  if (artifacts.some((a) => a.type === 'workflow-card' && Array.isArray(a.steps) && a.steps.length >= 3)) nextStep += 8;
  else if (/step\s+1|first[,:]|then[,:]/i.test(text)) nextStep += 4;
  nextStep = Math.min(20, nextStep);

  const total = spine + evidence + tool + challenge + nextStep;
  return { spine, evidence, tool, challenge, nextStep, total };
}

// ---------- main ----------
const TURNS = [
  "I'm burning $500/mo on Google Ads — 8 weeks, 0 conversions, $4.20 CPC, 78% bounce. I'm thinking of tripling the budget. Thoughts?",
  "Is it the landing page, the targeting, or the offer that's broken? How would you tell?",
  "Walk me through a teardown of my funnel — what should I look at first?",
  "What's the cheapest test (under $50, under a week) to find out if the offer itself resonates?",
  "If I had to set ONE leading indicator to monitor weekly, what should it be — and what's a healthy benchmark for a personal-finance SaaS at this stage?",
];

(async () => {
  const projectName = `marketing-sim-${Math.floor(Math.random() * 900 + 100)}`;
  console.log(`\n=== Marketing-sim: ${projectName} ===`);
  const project = await api('POST', '/api/projects', {
    name: projectName,
    description: 'personal finance app for freelancers',
    locale: 'en',
  });
  const projectId = project?.project_id || project?.id;
  if (!projectId) { console.error('no project id'); process.exit(1); }
  console.log(`project_id=${projectId}`);

  const conv = [];
  const turnRecords = [];

  for (let i = 0; i < TURNS.length; i++) {
    const prompt = TURNS[i];
    const turnNum = i + 1;
    console.log(`\n--- Turn ${turnNum} ---`);
    console.log(`  user: ${prompt}`);
    const t0 = Date.now();
    let r;
    try {
      r = await runChatTurn(projectId, prompt, conv);
    } catch (err) {
      console.log(`  ABORTED: ${err.message}`);
      turnRecords.push({ turn: turnNum, prompt, aborted: true, error: err.message, durationS: Math.round((Date.now()-t0)/1000), score: scoreTurn({ aborted: true, fullText: '', toolsCalled: [], artifacts: [], optionSet: null }) });
      // keep conv in sync so context flows even on abort (assistant=empty)
      conv.push({ role: 'user', content: prompt });
      continue;
    }
    const dt = Math.round((Date.now() - t0) / 1000);
    const artifacts = parseArtifacts(r.fullText);
    const optionSet = artifacts.find((a) => a.type === 'option-set');
    const proseOnly = r.fullText.replace(/:::artifact[\s\S]*?:::/g, '').replace(/<CITATIONS>[\s\S]*?<\/CITATIONS>/g, '').trim();
    const score = scoreTurn({ fullText: r.fullText, toolsCalled: r.toolsCalled, artifacts, optionSet, aborted: r.aborted, prompt });
    const cost = typeof r.donePayload?.usage?.cost === 'number' ? r.donePayload.usage.cost : 0;
    console.log(`  duration=${dt}s, cost=$${cost.toFixed(4)}, tools=[${[...new Set(r.toolsCalled)].join(',') || 'none'}], artifacts=${artifacts.length} (${artifacts.map(a=>a.type).join(',')})`);
    console.log(`  prose: ${proseOnly.slice(0, 280).replace(/\s+/g, ' ')}${proseOnly.length>280?'…':''}`);
    if (optionSet) console.log(`  options: ${(optionSet.options||[]).map(o=>`"${o.label}"`).join(', ')}`);
    console.log(`  score: spine=${score.spine} ev=${score.evidence} tool=${score.tool} chal=${score.challenge} next=${score.nextStep} TOTAL=${score.total}/100`);

    turnRecords.push({
      turn: turnNum,
      prompt,
      durationS: dt,
      cost,
      tools: r.toolsCalled,
      artifactTypes: artifacts.map(a => a.type),
      proseExcerpt: proseOnly.slice(0, 800),
      fullText: r.fullText,
      optionLabels: optionSet ? (optionSet.options || []).map(o => String(o?.label ?? '')) : [],
      score,
      aborted: false,
    });

    conv.push({ role: 'user', content: prompt });
    // Push assistant turn (prose + artifacts) so context flows naturally
    conv.push({ role: 'assistant', content: r.fullText });
  }

  // ---------- DB side effects ----------
  console.log(`\n=== DB side effects for ${projectId} ===`);
  const [memFacts, memEvents, plans, pending, monitors, alerts, skillCompl, sectionScores] = await Promise.all([
    db()`SELECT kind, fact FROM memory_facts WHERE project_id = ${projectId}`,
    db()`SELECT event_type FROM memory_events WHERE project_id = ${projectId}`,
    db()`SELECT id, name, status, jsonb_array_length(steps) AS step_count FROM workflow_plans WHERE project_id = ${projectId}`,
    db()`SELECT action_type, status FROM pending_actions WHERE project_id = ${projectId}`,
    db()`SELECT id, source_type, status FROM monitors WHERE project_id = ${projectId}`,
    db()`SELECT id, severity FROM ecosystem_alerts WHERE project_id = ${projectId}`,
    db()`SELECT skill_label, status FROM skill_completions WHERE project_id = ${projectId}`,
    db()`SELECT section_key, score FROM section_scores WHERE project_id = ${projectId}`,
  ]);
  console.log(`  memory_facts: ${memFacts.length}  (kinds: ${[...new Set(memFacts.map(f=>f.kind))].join(',') || '-'})`);
  console.log(`  memory_events: ${memEvents.length}  (types: ${[...new Set(memEvents.map(e=>e.event_type))].join(',') || '-'})`);
  console.log(`  workflow_plans: ${plans.length}  ${plans.map(p=>`"${p.name}"(${p.step_count}st,${p.status})`).join(', ')}`);
  console.log(`  pending_actions: ${pending.length}  (types: ${[...new Set(pending.map(p=>p.action_type))].join(',') || '-'})`);
  console.log(`  monitors: ${monitors.length}`);
  console.log(`  ecosystem_alerts: ${alerts.length}`);
  console.log(`  skill_completions: ${skillCompl.length}  ${skillCompl.map(s=>`${s.skill_label}(${s.status})`).join(', ')}`);
  console.log(`  section_scores: ${sectionScores.length}  ${sectionScores.map(s=>`${s.section_key}=${s.score}`).join(', ')}`);

  // ---------- output JSON for downstream report ----------
  const out = {
    projectId,
    projectName,
    turns: turnRecords,
    sideEffects: {
      memory_facts: memFacts.length,
      memory_fact_kinds: [...new Set(memFacts.map(f=>f.kind))],
      memory_events: memEvents.length,
      memory_event_types: [...new Set(memEvents.map(e=>e.event_type))],
      workflow_plans: plans.length,
      workflow_plan_summary: plans.map(p=>({ name: p.name, status: p.status, steps: p.step_count })),
      pending_actions: pending.length,
      pending_action_types: [...new Set(pending.map(p=>p.action_type))],
      monitors: monitors.length,
      ecosystem_alerts: alerts.length,
      skill_completions: skillCompl.length,
      section_scores: sectionScores.length,
    },
  };
  fs.writeFileSync('data/.marketing-sim.json', JSON.stringify(out, null, 2));
  console.log(`\nwrote data/.marketing-sim.json`);

  await db().end({ timeout: 5 });
})().catch(async (err) => {
  console.error('FATAL:', err);
  if (_sql) await _sql.end({ timeout: 5 });
  process.exit(1);
});
