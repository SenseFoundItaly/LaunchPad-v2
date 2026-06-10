#!/usr/bin/env node
/**
 * FULL FOUNDER SIMULATION (Phase 1: 12 turns, Phase 2: monitor cycle, Phase 3: aggregate)
 *
 * Tests the LaunchPad-v2 architecture end-to-end:
 *   - 7-stage progression (Idea → Operate)
 *   - skill_* tool firing → skill_completions + section_scores rows
 *   - idea_canvas updates as founder iterates
 *   - propose_monitor tool firing (Phase 2)
 *   - approve monitor → cron run → ecosystem_alert → next-turn citation
 */

import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3001';
const USER_ID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const TURN_TIMEOUT_MS = 240_000;

function loadDotEnvLocal() {
  const p = path.join('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2', '.env.local');
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
function db() {
  if (!_sql) _sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  return _sql;
}

async function api(method, pathStr, body, extraHeaders = {}) {
  const res = await fetch(`${BASE_URL}${pathStr}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID, ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok) {
    throw new Error(`${method} ${pathStr} → ${res.status}: ${(json?.error || text || res.statusText).slice(0, 200)}`);
  }
  if (json && typeof json === 'object' && json.success === true && 'data' in json) return json.data;
  return json;
}

function parseArtifacts(text) {
  const blocks = [...text.matchAll(/:::artifact\s*(\{[^\n]*?\})\s*\n([\s\S]*?)\n:::/g)];
  const parsed = [];
  for (const [_raw, headerStr, bodyStr] of blocks) {
    try {
      const header = JSON.parse(headerStr);
      const body = JSON.parse(bodyStr.trim());
      parsed.push({ ...header, ...body });
    } catch { /* skip */ }
  }
  return parsed;
}

async function runChatTurn(projectId, prompt, attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TURN_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
      body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content: prompt }] }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Retry once on transient fetch failure (server may have hot-reloaded mid-request).
    if (attempt < 2 && /fetch failed|terminated|ECONNRESET|ECONNREFUSED/i.test(err.message)) {
      console.log(`  (transient fetch error, retrying in 3s: ${err.message.slice(0, 80)})`);
      await new Promise(r => setTimeout(r, 3000));
      return runChatTurn(projectId, prompt, attempt + 1);
    }
    throw new Error(`chat fetch failed: ${err.message}`);
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new Error(`/api/chat ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  ctrl.signal.addEventListener('abort', () => {
    try { reader.cancel('client abort').catch(() => {}); } catch {}
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
            reader.cancel('client done').catch(() => {});
            break outer;
          }
        } catch {}
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { fullText, donePayload, toolsCalled, aborted: ctrl.signal.aborted, sawDone };
}

const TURNS = [
  { n: 1, stage: 1, topic: 'Lean Canvas request',
    ask: 'I have an idea for an AI-powered tutor app that prepares high school students for the SAT — specifically the math section — with adaptive practice and detailed explanations. Help me structure this — what should be in my Lean Canvas?' },
  { n: 2, stage: 1, topic: 'Fatal flaw risk',
    ask: "What's most likely to kill this idea — what's the fatal flaw?" },
  { n: 3, stage: 2, topic: 'Market size',
    ask: "How big is the SAT prep market? Is this $100M or $1B? Give me a real number with sources." },
  { n: 4, stage: 2, topic: 'Competitor scan',
    ask: "Who's already doing this? Khan Academy, Magoosh, others? Who do I really compete with?" },
  { n: 5, stage: 3, topic: 'ICP definition',
    ask: "Who's my ICP — students directly or parents who pay? Help me figure out who to interview." },
  { n: 6, stage: 4, topic: 'Pricing model',
    ask: "What's the right pricing model? $9/mo subscription, $19/mo, or one-time $99? What does the data say?" },
  { n: 7, stage: 5, topic: 'MVP form factor',
    ask: "Should I build mobile-first or web-first? What's the MVP shape that lets me validate fastest?" },
  { n: 8, stage: 5, topic: 'GTM first 100',
    ask: "How do I get my first 100 users? What channels actually work for an education product?" },
  { n: 9, stage: 7, topic: 'Weekly metrics',
    ask: "What weekly metrics should I track from day 1? I want a dashboard I can stare at every Monday." },
  { n: 10, stage: 6, topic: 'Fundraise prep',
    ask: "If I want to raise pre-seed in 6 months, what do I need? What does an investor want to see at this stage?" },
  { n: 11, stage: 'monitor', topic: 'Propose monitor for big-tech edu',
    ask: "I need to track Khan Academy launches and big-tech edu moves — set up the right monitor so I get pinged when something material happens." },
  { n: 12, stage: 'summary', topic: 'Where am I on spine',
    ask: "Where am I in the spine — what stage am I on, and what's blocking advance to the next stage?" },
];

const turnRecords = [];
let projectId = null;

async function main() {
  console.log('=== PHASE 1: 7-stage progression ===\n');

  // Verify dev server
  const meRes = await api('GET', '/api/me');
  console.log(`auth ok — userId=${meRes.userId}\n`);

  // Create fresh project
  const proj = await api('POST', '/api/projects', {
    name: `FOUNDER-SIM ${new Date().toISOString().slice(0, 19)}`,
    description: 'Solo founder (Python, 5 yrs eng, $15k runway). Idea: AI-powered SAT math tutor app with adaptive practice and detailed explanations for high schoolers. Just had the idea last week.',
    locale: 'en',
  });
  projectId = proj?.project_id || proj?.id;
  if (!projectId) throw new Error(`no projectId: ${JSON.stringify(proj)}`);
  console.log(`Created project: ${projectId}\n`);

  for (const turn of TURNS) {
    const t0 = Date.now();
    console.log(`--- T${turn.n} [Stage ${turn.stage}] ${turn.topic}`);
    console.log(`Q: "${turn.ask.slice(0, 100)}${turn.ask.length > 100 ? '…' : ''}"`);

    let r;
    let aborted = false;
    try {
      r = await runChatTurn(projectId, turn.ask);
    } catch (err) {
      aborted = true;
      console.log(`  ABORTED: ${err.message}`);
      r = { fullText: '', donePayload: null, toolsCalled: [], aborted: true, sawDone: false };
    }
    const dt = Math.round((Date.now() - t0) / 1000);
    const artifacts = parseArtifacts(r.fullText);
    const cost = typeof r.donePayload?.usage?.cost === 'number' ? r.donePayload.usage.cost : 0;
    const uniqueTools = [...new Set(r.toolsCalled)];
    const skillFires = r.toolsCalled.filter(t => t.startsWith('skill_'));

    // Query skill_completions delta after each turn
    const completions = await db()`
      SELECT skill_id, status, completed_at FROM skill_completions
       WHERE project_id = ${projectId} AND status = 'completed'`;
    const completedIds = completions.map(c => c.skill_id).sort();

    turnRecords.push({
      n: turn.n,
      stage: turn.stage,
      topic: turn.topic,
      ask: turn.ask,
      durationS: dt,
      cost,
      tools: r.toolsCalled,
      uniqueTools,
      skillFires,
      artifactTypes: artifacts.map(a => a.type),
      artifacts,
      fullText: r.fullText,
      donePayload: r.donePayload,
      aborted,
      completedSkillsAfter: completedIds,
    });

    const openingLine = r.fullText.split('\n').filter(l => l.trim() && !l.startsWith(':::artifact')).slice(0, 2).join(' ').slice(0, 200);
    console.log(`  T${turn.n} | ${turn.topic} | tools=[${uniqueTools.join(',')}] | skill_fires=[${skillFires.join(',')}] | latency=${dt}s | cost=$${cost.toFixed(4)} | artifacts=[${artifacts.map(a => a.type).join(',')}]`);
    if (openingLine) console.log(`  opening: "${openingLine.slice(0, 150)}${openingLine.length > 150 ? '…' : ''}"`);
    console.log('');
  }

  // ===========================================================================
  // PHASE 2: monitor weekly cycle
  // ===========================================================================
  console.log('\n=== PHASE 2: monitor weekly cycle ===\n');

  // (1) Check pending_actions for configure_monitor
  const pendingMonitor = await db()`
    SELECT id, payload, edited_payload, title, status, created_at
      FROM pending_actions
     WHERE project_id = ${projectId} AND action_type = 'configure_monitor'
     ORDER BY created_at DESC LIMIT 1`;
  console.log(`(1) pending_actions[configure_monitor]: ${pendingMonitor.length} found`);

  let monitorApproved = false;
  let monitorApprovalResp = null;
  let monitorId = null;
  let cronRunResult = null;
  let alertCount = 0;
  let t13Result = null;

  if (pendingMonitor.length === 0) {
    console.log('  (no monitor proposed by agent — skipping approval steps)');
  } else {
    const pa = pendingMonitor[0];
    console.log(`  pending_action: id=${pa.id} title="${pa.title}" status=${pa.status}`);

    // (2) Approve
    try {
      monitorApprovalResp = await api('POST', `/api/projects/${projectId}/actions/${pa.id}`, { transition: 'apply' });
      monitorApproved = true;
      console.log(`(2) APPROVED — deliverable mode=${monitorApprovalResp.deliverable?.mode} created_row_id=${monitorApprovalResp.deliverable?.created_row_id}`);
    } catch (err) {
      console.log(`(2) APPROVE FAILED: ${err.message}`);
    }

    // (3) Verify monitor row
    const monitors = await db()`
      SELECT id, name, status, next_run FROM monitors WHERE project_id = ${projectId}`;
    console.log(`(3) monitors table: ${monitors.length} found`);
    for (const m of monitors) console.log(`  ${m.id} | ${m.name} | status=${m.status} | next_run=${m.next_run}`);
    if (monitors.length > 0) monitorId = monitors[0].id;

    // (4) Trigger cron
    if (monitorId) {
      const cronSecret = process.env.CRON_SECRET;
      console.log(`(4) Triggering cron force=true&monitor_id=${monitorId}…`);
      try {
        const cronRes = await fetch(`${BASE_URL}/api/cron?force=true&monitor_id=${monitorId}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cronSecret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const cronText = await cronRes.text();
        let cronJson = null;
        try { cronJson = JSON.parse(cronText); } catch {}
        cronRunResult = { status: cronRes.status, body: cronJson || cronText.slice(0, 200) };
        console.log(`  cron response: ${cronRes.status} — ${JSON.stringify(cronJson).slice(0, 300)}`);
      } catch (err) {
        console.log(`  cron error: ${err.message}`);
      }
    }

    // (5) Check monitor_runs + ecosystem_alerts
    const runs = await db()`
      SELECT id, monitor_id, status, alerts_generated, run_at, trigger_type
        FROM monitor_runs WHERE project_id = ${projectId} ORDER BY run_at DESC LIMIT 5`;
    console.log(`(5a) monitor_runs: ${runs.length} found`);
    for (const r of runs) console.log(`  run ${r.id} | monitor=${r.monitor_id} | status=${r.status} | alerts=${r.alerts_generated} | trigger=${r.trigger_type}`);

    const alerts = await db()`
      SELECT id, headline, relevance_score, source_url, created_at
        FROM ecosystem_alerts WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 5`;
    alertCount = alerts.length;
    console.log(`(5b) ecosystem_alerts: ${alerts.length} found`);
    for (const a of alerts) console.log(`  ${a.id} | relevance=${a.relevance_score} | "${a.headline?.slice(0, 80)}"`);

    // (6) T13 — agent surfaces signal?
    console.log('\n(6) T13 — "Anything new in the ecosystem since we last talked?"');
    const t0 = Date.now();
    try {
      const r = await runChatTurn(projectId, 'Anything new in the ecosystem since we last talked?');
      const dt = Math.round((Date.now() - t0) / 1000);
      const openingProse = r.fullText.replace(/:::artifact[\s\S]*?:::/g, '').trim().split('\n').filter(l => l.trim()).slice(0, 3).join(' ');
      t13Result = {
        durationS: dt,
        toolsCalled: r.toolsCalled,
        opening: openingProse.slice(0, 400),
        fullText: r.fullText,
        cost: r.donePayload?.usage?.cost || 0,
      };
      console.log(`  T13 (${dt}s, $${t13Result.cost.toFixed(4)}): tools=[${[...new Set(r.toolsCalled)].join(',')}]`);
      console.log(`  opening: "${openingProse.slice(0, 300)}"`);
    } catch (err) {
      console.log(`  T13 ERROR: ${err.message}`);
    }
  }

  // ===========================================================================
  // PHASE 3: aggregate verification
  // ===========================================================================
  console.log('\n\n=== PHASE 3: aggregate verification ===\n');

  const sql = db();

  const sc = await sql`SELECT skill_id, status, completed_at FROM skill_completions WHERE project_id = ${projectId} ORDER BY completed_at`;
  console.log(`(1) skill_completions: ${sc.length} rows`);
  for (const r of sc) console.log(`  ${r.skill_id.padEnd(28)} | ${r.status} | ${r.completed_at}`);

  const ic = await sql`SELECT * FROM idea_canvas WHERE project_id = ${projectId}`;
  console.log(`\n(2) idea_canvas: ${ic.length === 1 ? 'present' : 'absent'}`);
  if (ic.length === 1) {
    const fields = ['problem', 'solution', 'target_market', 'business_model', 'competitive_advantage', 'value_proposition', 'unfair_advantage'];
    const filled = fields.filter(f => ic[0][f] && String(ic[0][f]).trim().length > 0);
    console.log(`  filled (${filled.length}/${fields.length}): ${filled.join(', ')}`);
    for (const f of filled) console.log(`  ${f}: "${String(ic[0][f]).slice(0, 100)}${String(ic[0][f]).length > 100 ? '…' : ''}"`);
  }

  // section_scores is a JSONB column on skill_completions (per-stage dimension scores),
  // plus a project-level scores table tracks aggregate health (overall + dimensions).
  const ss = await sql`
    SELECT skill_id, status, section_scores
      FROM skill_completions
     WHERE project_id = ${projectId} AND section_scores IS NOT NULL`;
  console.log(`\n(3) skill_completions.section_scores: ${ss.length} rows with non-null JSONB`);
  for (const r of ss) {
    const keys = r.section_scores && typeof r.section_scores === 'object' ? Object.keys(r.section_scores) : [];
    console.log(`  ${r.skill_id.padEnd(28)} | dims=${keys.length}: ${keys.slice(0,5).join(',')}`);
  }
  const projScores = await sql`SELECT overall_score, benchmark, recommendation, sources FROM scores WHERE project_id = ${projectId}`;
  if (projScores.length > 0) {
    console.log(`  project scores row: overall=${projScores[0].overall_score} benchmark=${projScores[0].benchmark}`);
  } else {
    console.log(`  (no project-level scores row yet)`);
  }

  const ms = await sql`SELECT id, name, status, last_run FROM monitors WHERE project_id = ${projectId}`;
  console.log(`\n(4) monitors: ${ms.length} rows`);
  for (const m of ms) console.log(`  ${m.id} | ${m.name} | status=${m.status} | last_run=${m.last_run}`);

  const mr = await sql`SELECT COUNT(*)::int AS c FROM monitor_runs WHERE project_id = ${projectId}`;
  console.log(`\n(5) monitor_runs: ${mr[0].c} rows`);

  const ea = await sql`SELECT COUNT(*)::int AS c FROM ecosystem_alerts WHERE project_id = ${projectId}`;
  console.log(`\n(6) ecosystem_alerts: ${ea[0].c} rows`);

  const pa = await sql`SELECT COUNT(*)::int AS c FROM pending_actions WHERE project_id = ${projectId} AND action_type = 'configure_monitor'`;
  console.log(`\n(7) pending_actions[configure_monitor]: ${pa[0].c} rows`);

  const gn = await sql`SELECT reviewed_state, COUNT(*)::int AS c FROM graph_nodes WHERE project_id = ${projectId} GROUP BY reviewed_state`;
  console.log(`\n(8) graph_nodes by reviewed_state:`);
  for (const r of gn) console.log(`  ${r.reviewed_state}: ${r.c}`);
  if (gn.length === 0) console.log(`  (none)`);

  const llm = await sql`SELECT COUNT(*)::int AS c, AVG(total_cost_usd)::float AS avg_cost, SUM(total_cost_usd)::float AS sum_cost FROM llm_usage_logs WHERE project_id = ${projectId}`;
  console.log(`\n(9) llm_usage_logs: ${llm[0].c} rows | avg $${(llm[0].avg_cost || 0).toFixed(4)} | total $${(llm[0].sum_cost || 0).toFixed(4)}`);

  // (10) T13 opening
  console.log(`\n(10) T13 response — signal surfaced?`);
  if (t13Result) {
    console.log(`  opening: "${t13Result.opening.slice(0, 400)}"`);
  } else {
    console.log(`  (T13 did not run)`);
  }

  // Summary table
  console.log('\n\n=== PER-TURN SUMMARY ===');
  console.log('T# | stage | topic                       | tools                                | skill_fires            | latency | cost');
  console.log('---|-------|-----------------------------|--------------------------------------|------------------------|---------|------');
  for (const r of turnRecords) {
    const tools = (r.uniqueTools.join(',') || '-').slice(0, 36);
    const fires = (r.skillFires.join(',') || '-').slice(0, 22);
    const topic = r.topic.slice(0, 27);
    console.log(`T${String(r.n).padStart(2)} | ${String(r.stage).padEnd(5)} | ${topic.padEnd(27)} | ${tools.padEnd(36)} | ${fires.padEnd(22)} | ${(r.durationS+'s').padStart(6)} | $${r.cost.toFixed(4)}`);
  }

  const totalCost = turnRecords.reduce((s, r) => s + r.cost, 0) + (t13Result?.cost || 0);
  const totalTime = turnRecords.reduce((s, r) => s + r.durationS, 0) + (t13Result?.durationS || 0);
  console.log(`\nTOTAL: ${turnRecords.length + (t13Result ? 1 : 0)} turns | $${totalCost.toFixed(4)} | ${totalTime}s wall`);

  // Save report
  const report = {
    projectId,
    totalCost,
    totalWallS: totalTime,
    turnRecords: turnRecords.map(t => ({
      n: t.n, stage: t.stage, topic: t.topic, ask: t.ask,
      durationS: t.durationS, cost: t.cost,
      uniqueTools: t.uniqueTools, skillFires: t.skillFires,
      artifactTypes: t.artifactTypes,
      completedSkillsAfter: t.completedSkillsAfter,
      aborted: t.aborted,
    })),
    phase2: {
      monitorProposed: pendingMonitor.length > 0,
      monitorApproved,
      monitorApprovalResp: monitorApprovalResp ? {
        deliverable: monitorApprovalResp.deliverable,
        status: monitorApprovalResp.status,
      } : null,
      monitorId,
      cronRunResult,
      alertsLanded: alertCount,
      t13: t13Result ? {
        durationS: t13Result.durationS,
        toolsCalled: t13Result.toolsCalled,
        opening: t13Result.opening,
        cost: t13Result.cost,
      } : null,
    },
    phase3: {
      skillCompletions: sc.map(r => ({ skill_id: r.skill_id, status: r.status })),
      ideaCanvasFilled: ic.length === 1 ? Object.keys(ic[0]).filter(k => ic[0][k] && typeof ic[0][k] === 'string' && ic[0][k].trim().length > 0 && !['project_id', 'created_at', 'updated_at', 'id'].includes(k)) : [],
      sectionScores: ss.map(r => ({ skill_id: r.skill_id, dimensions: Object.keys(r.section_scores || {}) })),
      projectScores: projScores,
      monitors: ms,
      monitorRuns: mr[0].c,
      ecosystemAlerts: ea[0].c,
      configMonitorActions: pa[0].c,
      graphNodes: gn,
      llmTotalCost: llm[0].sum_cost,
      llmRows: llm[0].c,
    },
  };
  fs.writeFileSync('/tmp/founder-sim-report.json', JSON.stringify(report, null, 2));
  console.log(`\nWrote report → /tmp/founder-sim-report.json`);

  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error('\nFATAL:', err);
  if (_sql) await _sql.end({ timeout: 5 });
  process.exit(1);
});
