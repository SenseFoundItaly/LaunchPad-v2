#!/usr/bin/env node
// Founder-simulator: MVP / build uncertainty domain
// 5-turn smarcamento chat against LaunchPad-v2 local dev, then score.

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3001';
const USER_ID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const TURN_TIMEOUT_MS = 240_000;
const PROJECT_DIR = '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2';

// Load .env.local
function loadDotEnvLocal() {
  const p = path.join(PROJECT_DIR, '.env.local');
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

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 2 });

async function api(method, p, body) {
  const res = await fetch(`${BASE_URL}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    throw new Error(`${method} ${p} → ${res.status}: ${(text || '').slice(0, 240)}`);
  }
  if (json && typeof json === 'object' && json.success === true && 'data' in json) {
    return json.data;
  }
  return json;
}

async function streamChat(projectId, messages) {
  const ctrl = new AbortController();
  const incidents = [];
  const timer = setTimeout(() => { ctrl.abort(); incidents.push('abort_240s'); }, TURN_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
      body: JSON.stringify({ project_id: projectId, step: 'chat', messages }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    incidents.push(`fetch_failed:${err.message.slice(0,80)}`);
    return { text: '', done: false, incidents, toolCalls: [] };
  }
  if (!res.ok) {
    clearTimeout(timer);
    const t = await res.text();
    incidents.push(`http_${res.status}:${t.slice(0,80)}`);
    return { text: '', done: false, incidents, toolCalls: [] };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let sawDone = false;
  let fullText = '';
  const toolCalls = [];
  try {
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
          if (payload.tool_use) toolCalls.push(payload.tool_use);
          if (payload.tool_call) toolCalls.push(payload.tool_call);
          if (payload.event === 'tool_call' && payload.name) toolCalls.push({ name: payload.name });
          if (payload.done) sawDone = true;
        } catch {}
      }
    }
  } catch (err) {
    incidents.push(`stream_err:${err.message.slice(0,80)}`);
  }
  clearTimeout(timer);
  if (!sawDone) incidents.push('no_done_event');
  return { text: fullText, done: sawDone, incidents, toolCalls };
}

function parseArtifacts(text) {
  const blocks = [...text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)];
  const parsed = [];
  for (const [, headerStr, bodyStr] of blocks) {
    try {
      const header = JSON.parse(headerStr);
      const body = JSON.parse(bodyStr.trim());
      parsed.push({ ...header, ...body });
    } catch {}
  }
  return parsed;
}

// ---- Scoring helpers ----
const SPINE_KEYWORDS = ['stage', 'spine', 'problem', 'audience', 'evidence', 'validation', 'discovery', 'mvp', 'build', 'launch'];
const SIGNAL_KEYWORDS = ['source', 'evidence', 'data', 'benchmark', 'similar product', 'competitor', 'case study', 'research'];
const RIGHT_TOOL_KEYWORDS = ['skill_mvp_design', 'skill_technical_validation', 'propose_monitor', 'skill_problem_validation', 'mvp design', 'technical validation', 'monitor', 'run a skill', 'fire'];
const CHALLENGE_KEYWORDS = ['risk', 'realistic', "actually", 'assumption', 'tradeoff', 'why', 'what if', 'how confident', 'unrealistic', 'instead', 'before', 'first you', 'wait', 'too ambitious', 'over-scope', 'unclear'];
const NEXT_STEP_KEYWORDS = ['next', 'step', 'do this', 'today', 'this week', 'i recommend', 'option', 'shall we', 'kick off', 'start with', 'first do'];

const MVP_SPECIFIC = {
  noCode: /no[- ]?code|bubble|webflow|airtable|glide|softr|hacky/i,
  landingPage: /landing page|waitlist|sign[- ]?up form|smoke test|fake door|pre-?sell/i,
  wearableRisk: /wearable|fitbit|garmin|apple health|whoop|oura|healthkit|google fit|api integration/i,
  aiRisk: /ai quality|model accuracy|workout quality|prompt|llm|hallucination|safety/i,
  riskMap: /risk.*(map|validate|test)|map.*risk|risk.*step/i,
};

function scoreTurn(turnText, parsedArtifacts, toolCalls) {
  const t = turnText.toLowerCase();
  const countMatches = (kws) => kws.reduce((n, k) => n + (t.includes(k.toLowerCase()) ? 1 : 0), 0);

  const spineHits = countMatches(SPINE_KEYWORDS);
  const signalHits = countMatches(SIGNAL_KEYWORDS);
  const toolHits = countMatches(RIGHT_TOOL_KEYWORDS);
  const challengeHits = countMatches(CHALLENGE_KEYWORDS);
  const nextHits = countMatches(NEXT_STEP_KEYWORDS);

  // sub-scores 0-20 with cap
  const cap20 = (n, perHit = 5) => Math.min(20, n * perHit);

  let spine = cap20(spineHits, 4);
  let signal = cap20(signalHits, 5);
  // tool: bonus if actually called via tool calls or proposed via option-set
  let tool = cap20(toolHits, 5);
  const calledMvpDesign = toolCalls.some(tc => /mvp[_-]?design|technical[_-]?validation|propose[_-]?monitor|run[_-]?skill/.test((tc.name || tc.tool || '').toLowerCase()));
  if (calledMvpDesign) tool = Math.min(20, tool + 8);
  const hasMonitorOrSkillArtifact = parsedArtifacts.some(a => /monitor-proposal|action-suggestion|workflow-card/i.test(a.type || ''));
  if (hasMonitorOrSkillArtifact) tool = Math.min(20, tool + 4);

  let challenge = cap20(challengeHits, 4);
  let next = cap20(nextHits, 4);

  // Artifact penalty: no artifacts means weak structure
  if (parsedArtifacts.length === 0) {
    spine = Math.max(0, spine - 4);
    next = Math.max(0, next - 4);
  }

  // option-set: well-formed next step
  const hasOption = parsedArtifacts.some(a => a.type === 'option-set');
  if (hasOption) next = Math.min(20, next + 4);

  const total = spine + signal + tool + challenge + next;
  return { spine, signal, tool, challenge, next, total };
}

function detectMvpGaps(allText) {
  return {
    surfaced_no_code_tradeoff: MVP_SPECIFIC.noCode.test(allText),
    mapped_risks_to_validation: MVP_SPECIFIC.riskMap.test(allText) || (MVP_SPECIFIC.wearableRisk.test(allText) && /validate|test|spike|prototype|prove/i.test(allText)),
    suggested_landing_page_test: MVP_SPECIFIC.landingPage.test(allText),
    addressed_wearable_risk: MVP_SPECIFIC.wearableRisk.test(allText),
    addressed_ai_quality_risk: MVP_SPECIFIC.aiRisk.test(allText),
  };
}

// ---- Main ----
async function main() {
  console.log('=== MVP/Build Uncertainty Simulator ===\n');

  // 1. Verify health
  const health = await fetch(`${BASE_URL}/api/health`).then(r => r.ok).catch(() => false);
  if (!health) { console.error('Dev server /api/health failed'); process.exit(1); }

  // 2. Create project
  const projectName = `mvp-sim-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
  const project = await api('POST', '/api/projects', {
    name: projectName,
    description: 'AI fitness app generating weekly workout plans from wearable data',
    locale: 'en',
  });
  const projectId = project?.project_id || project?.id;
  console.log(`Project created: ${projectId} (name=${projectName})\n`);

  // 3. Conversation
  const turns = [
    "I have an idea — a fitness app that uses AI to generate weekly workout plans from your wearable data (Apple Watch, Garmin, Whoop). I'm solo, 5y JS exp, $15k runway, 6 months. Web first or mobile first?",
    "What about building with no-code first (Bubble, Glide)? Could that work for a wearable-integrated app?",
    "OK realistic question: what's the smallest thing I can ship in 2 weeks to actually test demand before I write any real code?",
    "Of the technical risks — wearable API integration vs AI workout quality — which one is the biggest threat to my 6-month runway? Which one should I de-risk first?",
    "If you had to pick ONE thing for me to do this week, what would it be? I need to start.",
  ];

  const messages = [];
  const turnResults = [];
  const allTextForGaps = [];

  for (let i = 0; i < turns.length; i++) {
    const userMsg = turns[i];
    messages.push({ role: 'user', content: userMsg });
    const t0 = Date.now();
    console.log(`--- Turn ${i + 1} ---`);
    console.log(`> ${userMsg}`);
    const result = await streamChat(projectId, messages);
    const elapsed = Date.now() - t0;
    const artifacts = parseArtifacts(result.text);
    const score = scoreTurn(result.text, artifacts, result.toolCalls);
    turnResults.push({
      turn: i + 1, userMsg, response: result.text, elapsedMs: elapsed,
      done: result.done, artifacts: artifacts.map(a => a.type),
      toolCalls: result.toolCalls.map(tc => tc.name || tc.tool || JSON.stringify(tc).slice(0,60)),
      incidents: result.incidents, score,
    });
    allTextForGaps.push(result.text);
    // Add assistant reply to messages for next turn
    messages.push({ role: 'assistant', content: result.text });
    console.log(`  done=${result.done} elapsed=${elapsed}ms artifacts=${artifacts.length} tools=${result.toolCalls.length} score=${score.total} incidents=${result.incidents.join(',') || 'none'}`);
    console.log(`  preview: ${result.text.replace(/:::artifact[\s\S]*?:::/g,'[ARTIFACT]').slice(0,180).replace(/\n/g,' ')}...\n`);
  }

  // 4. DB side effects
  console.log('--- DB Side Effects ---');
  const [skillRuns, pendingActions, skillCompletions, sectionScores, monitorProposals, chatMessages] = await Promise.all([
    sql`SELECT id, skill_id, status, created_at FROM skill_runs WHERE project_id = ${projectId} ORDER BY created_at`.catch(() => []),
    sql`SELECT id, action_type, status, created_at FROM pending_actions WHERE project_id = ${projectId} ORDER BY created_at`.catch(() => []),
    sql`SELECT skill_id, status, created_at FROM skill_completions WHERE project_id = ${projectId} ORDER BY created_at`.catch(() => []),
    sql`SELECT section_id, score, evidence_score, created_at FROM section_scores WHERE project_id = ${projectId} ORDER BY created_at`.catch(() => []),
    sql`SELECT id, status, created_at FROM monitors WHERE project_id = ${projectId} ORDER BY created_at`.catch(() => []),
    sql`SELECT id, role, length(content) as len FROM chat_messages WHERE project_id = ${projectId} ORDER BY created_at`.catch(() => []),
  ]);
  console.log(`chat_messages: ${chatMessages.length}`);
  console.log(`skill_runs: ${skillRuns.length} (${skillRuns.map(r=>r.skill_id+':'+r.status).join(', ') || 'none'})`);
  console.log(`pending_actions: ${pendingActions.length} (${pendingActions.map(r=>r.action_type+':'+r.status).join(', ') || 'none'})`);
  console.log(`skill_completions: ${skillCompletions.length}`);
  console.log(`section_scores: ${sectionScores.length}`);
  console.log(`monitors: ${monitorProposals.length}`);

  // 5. Domain aggregate + analysis
  console.log('\n=== SCORING TABLE ===');
  console.log('Turn | Spine | Signal | Tool | Challenge | Next | Total');
  console.log('-----|-------|--------|------|-----------|------|------');
  for (const tr of turnResults) {
    const s = tr.score;
    console.log(`  ${tr.turn}  |  ${String(s.spine).padStart(3)}  |  ${String(s.signal).padStart(4)}  |  ${String(s.tool).padStart(3)} |    ${String(s.challenge).padStart(3)}    |  ${String(s.next).padStart(3)} |  ${s.total}`);
  }
  const agg = turnResults.reduce((a, t) => a + t.score.total, 0) / turnResults.length;
  console.log(`Domain aggregate: ${agg.toFixed(1)} / 100`);

  // Best / worst
  const sorted = [...turnResults].sort((a,b) => b.score.total - a.score.total);
  const best = sorted[0], worst = sorted[sorted.length - 1];
  const bestQuote = best.response.replace(/:::artifact[\s\S]*?:::/g,'').slice(0, 280).replace(/\n/g,' ');
  const worstQuote = worst.response.replace(/:::artifact[\s\S]*?:::/g,'').slice(0, 280).replace(/\n/g,' ');
  console.log(`\nBest turn ${best.turn} (${best.score.total}): "${bestQuote}..."`);
  console.log(`\nWorst turn ${worst.turn} (${worst.score.total}): "${worstQuote}..."`);

  // MVP gaps
  const gaps = detectMvpGaps(allTextForGaps.join('\n'));
  console.log('\n=== MVP-Specific Gaps ===');
  for (const [k, v] of Object.entries(gaps)) {
    console.log(`  ${k}: ${v ? 'YES' : 'NO'}`);
  }

  // Reliability incidents
  console.log('\n=== Reliability ===');
  for (const tr of turnResults) {
    if (tr.incidents.length > 0 || !tr.done || tr.elapsedMs > 200000) {
      console.log(`  Turn ${tr.turn}: incidents=${tr.incidents.join(',') || 'none'} done=${tr.done} elapsed=${tr.elapsedMs}ms`);
    }
  }

  // Final JSON
  console.log('\n=== JSON SUMMARY ===');
  console.log(JSON.stringify({
    project_id: projectId,
    project_name: projectName,
    aggregate: Number(agg.toFixed(1)),
    turns: turnResults.map(tr => ({
      n: tr.turn, total: tr.score.total, ...tr.score,
      elapsed_ms: tr.elapsedMs, done: tr.done,
      artifacts: tr.artifacts, tools: tr.toolCalls, incidents: tr.incidents,
    })),
    db: {
      chat_messages: chatMessages.length,
      skill_runs: skillRuns.length,
      pending_actions: pendingActions.length,
      skill_completions: skillCompletions.length,
      section_scores: sectionScores.length,
      monitors: monitorProposals.length,
    },
    gaps,
  }, null, 2));

  await sql.end({ timeout: 5 });
}

main().catch(async err => {
  console.error('FATAL:', err);
  try { await sql.end({ timeout: 2 }); } catch {}
  process.exit(1);
});
