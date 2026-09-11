#!/usr/bin/env node
/**
 * Phase 2 (steps 3-6) + Phase 3 only, against the existing project from the
 * partial run. Skips the 12-turn replay.
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const BASE_URL = 'http://localhost:3001';
const USER_ID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const PROJECT_ID = 'proj_43d186bb-ca9';

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

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

async function api(method, pathStr, body) {
  const res = await fetch(`${BASE_URL}${pathStr}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: res.status, ok: res.ok, json, text };
}

async function runChatTurn(projectId, prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 240_000);
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-e2e-user': USER_ID },
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content: prompt }] }),
    signal: ctrl.signal,
  });
  if (!res.ok) { clearTimeout(timer); throw new Error(`/api/chat ${res.status}: ${(await res.text()).slice(0, 200)}`); }
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
  return { fullText, donePayload, toolsCalled };
}

async function main() {
  console.log('=== PHASE 2 (continued) + PHASE 3 ===\n');
  console.log(`Project: ${PROJECT_ID}\n`);

  // (1) Inspect all pending monitor proposals
  const allProposals = await sql`
    SELECT id, status, title, payload->>'kind' AS kind, execution_result
      FROM pending_actions WHERE project_id = ${PROJECT_ID} AND action_type = 'configure_monitor'
     ORDER BY created_at`;
  console.log(`(1) configure_monitor proposals: ${allProposals.length}`);
  for (const p of allProposals) console.log(`  ${p.id} | status=${p.status} | kind=${p.kind} | "${p.title.slice(0, 70)}" | exec_result=${p.execution_result ? JSON.stringify(p.execution_result).slice(0, 150) : 'null'}`);

  // (2) Try applying each pending one. First failed with "objective column missing" — re-try to confirm.
  const approvals = [];
  for (const p of allProposals.filter(x => x.status === 'pending')) {
    console.log(`\n(2) Attempting apply on ${p.id}…`);
    const r = await api('POST', `/api/projects/${PROJECT_ID}/actions/${p.id}`, { transition: 'apply' });
    console.log(`  status=${r.status} ok=${r.ok}`);
    console.log(`  resp: ${JSON.stringify(r.json).slice(0, 400)}`);
    approvals.push({ id: p.id, kind: p.kind, status: r.status, response: r.json });
  }

  // (3) Verify monitor row
  const monitors = await sql`
    SELECT id, name, status, schedule, kind, next_run, last_run FROM monitors WHERE project_id = ${PROJECT_ID}`;
  console.log(`\n(3) monitors: ${monitors.length} rows`);
  for (const m of monitors) console.log(`  ${m.id} | ${m.name} | status=${m.status} | schedule=${m.schedule} | kind=${m.kind} | next_run=${m.next_run}`);

  let cronStatus = null, cronJson = null;
  let runs = [];
  let alerts = [];

  if (monitors.length > 0) {
    const monitorId = monitors[0].id;
    const cronSecret = process.env.CRON_SECRET;

    // (4) Trigger cron
    console.log(`\n(4) Triggering cron force=true&monitor_id=${monitorId}…`);
    try {
      const cronRes = await fetch(`${BASE_URL}/api/cron?force=true&monitor_id=${monitorId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cronSecret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      cronStatus = cronRes.status;
      const text = await cronRes.text();
      try { cronJson = JSON.parse(text); } catch { cronJson = text.slice(0, 400); }
      console.log(`  cron response: ${cronStatus}`);
      console.log(`  body: ${JSON.stringify(cronJson).slice(0, 800)}`);
    } catch (err) {
      console.log(`  cron error: ${err.message}`);
    }

    // (5) monitor_runs + ecosystem_alerts
    runs = await sql`
      SELECT id, monitor_id, status, summary, alerts_generated, run_at, trigger_type
        FROM monitor_runs WHERE project_id = ${PROJECT_ID} ORDER BY run_at DESC LIMIT 5`;
    console.log(`\n(5a) monitor_runs: ${runs.length} rows`);
    for (const r of runs) console.log(`  ${r.id} | mon=${r.monitor_id} | status=${r.status} | alerts=${r.alerts_generated} | trigger=${r.trigger_type}`);

    alerts = await sql`
      SELECT id, headline, relevance_score, alert_type, reviewed_state
        FROM ecosystem_alerts WHERE project_id = ${PROJECT_ID} ORDER BY created_at DESC LIMIT 5`;
    console.log(`\n(5b) ecosystem_alerts: ${alerts.length} rows`);
    for (const a of alerts) console.log(`  ${a.id} | type=${a.alert_type} | rel=${a.relevance_score} | review=${a.reviewed_state} | "${a.headline?.slice(0, 80)}"`);
  } else {
    console.log('\n(4-5) Skipping cron/runs/alerts — no monitor row exists');
  }

  // (6) T13 — does the agent surface the propose+approve gap?
  console.log(`\n(6) T13 — "Anything new in the ecosystem since we last talked?"`);
  const t0 = Date.now();
  let t13 = null;
  try {
    const r = await runChatTurn(PROJECT_ID, 'Anything new in the ecosystem since we last talked?');
    const dt = Math.round((Date.now() - t0) / 1000);
    const openingProse = r.fullText.replace(/:::artifact[\s\S]*?:::/g, '').trim().split('\n').filter(l => l.trim()).slice(0, 4).join(' ');
    t13 = { durationS: dt, toolsCalled: r.toolsCalled, opening: openingProse.slice(0, 800), cost: r.donePayload?.usage?.cost || 0 };
    console.log(`  T13 (${dt}s, $${t13.cost.toFixed(4)}): tools=[${[...new Set(r.toolsCalled)].join(',')}]`);
    console.log(`  OPENING (first ~600 chars):`);
    console.log(`  "${openingProse.slice(0, 800)}"`);
  } catch (err) {
    console.log(`  T13 ERROR: ${err.message}`);
  }

  // ===========================================================================
  // PHASE 3
  // ===========================================================================
  console.log('\n\n=== PHASE 3: aggregate verification ===\n');

  const sc = await sql`SELECT skill_id, status, completed_at FROM skill_completions WHERE project_id = ${PROJECT_ID} ORDER BY completed_at`;
  console.log(`(1) skill_completions: ${sc.length} rows`);
  for (const r of sc) console.log(`  ${r.skill_id.padEnd(28)} | ${r.status} | ${r.completed_at}`);

  const ic = await sql`SELECT * FROM idea_canvas WHERE project_id = ${PROJECT_ID}`;
  console.log(`\n(2) idea_canvas: ${ic.length === 1 ? 'present' : 'absent'}`);
  if (ic.length === 1) {
    const fields = ['problem', 'solution', 'target_market', 'business_model', 'competitive_advantage', 'value_proposition', 'unfair_advantage'];
    const filled = fields.filter(f => ic[0][f] && String(ic[0][f]).trim().length > 0);
    console.log(`  filled (${filled.length}/${fields.length}): ${filled.join(', ')}`);
  }

  const ss = await sql`
    SELECT skill_id, status, section_scores
      FROM skill_completions WHERE project_id = ${PROJECT_ID} AND section_scores IS NOT NULL`;
  console.log(`\n(3) skill_completions with non-null section_scores: ${ss.length} rows`);
  for (const r of ss) {
    const keys = r.section_scores && typeof r.section_scores === 'object' ? Object.keys(r.section_scores) : [];
    console.log(`  ${r.skill_id.padEnd(28)} | dims=${keys.length}: ${keys.slice(0,5).join(',')}`);
  }
  const projScores = await sql`SELECT overall_score, benchmark, recommendation FROM scores WHERE project_id = ${PROJECT_ID}`;
  console.log(`  project-level scores row: ${projScores.length > 0 ? `overall=${projScores[0].overall_score} benchmark=${projScores[0].benchmark}` : 'none'}`);

  console.log(`\n(4) monitors total: ${monitors.length}`);
  console.log(`(5) monitor_runs total: ${runs.length}`);
  console.log(`(6) ecosystem_alerts total: ${alerts.length}`);

  const pa = await sql`SELECT id, status FROM pending_actions WHERE project_id = ${PROJECT_ID} AND action_type = 'configure_monitor' ORDER BY created_at`;
  console.log(`\n(7) pending_actions[configure_monitor]: ${pa.length} rows`);
  for (const a of pa) console.log(`  ${a.id} | status=${a.status}`);

  const gn = await sql`SELECT reviewed_state, COUNT(*)::int AS c FROM graph_nodes WHERE project_id = ${PROJECT_ID} GROUP BY reviewed_state`;
  console.log(`\n(8) graph_nodes by reviewed_state:`);
  for (const r of gn) console.log(`  ${r.reviewed_state}: ${r.c}`);
  if (gn.length === 0) console.log(`  (none)`);

  const llm = await sql`SELECT COUNT(*)::int AS c, AVG(total_cost_usd)::float AS avg_cost, SUM(total_cost_usd)::float AS sum_cost FROM llm_usage_logs WHERE project_id = ${PROJECT_ID}`;
  console.log(`\n(9) llm_usage_logs: ${llm[0].c} rows | avg $${(llm[0].avg_cost || 0).toFixed(4)} | total $${(llm[0].sum_cost || 0).toFixed(4)}`);

  const facts = await sql`SELECT kind, COUNT(*)::int AS c FROM memory_facts WHERE project_id = ${PROJECT_ID} GROUP BY kind ORDER BY c DESC`;
  console.log(`\n(extra) memory_facts by kind:`);
  for (const f of facts) console.log(`  ${f.kind.padEnd(20)} ${f.c}`);
  const events = await sql`SELECT event_type, COUNT(*)::int AS c FROM memory_events WHERE project_id = ${PROJECT_ID} GROUP BY event_type ORDER BY c DESC`;
  console.log(`\n(extra) memory_events by type:`);
  for (const e of events) console.log(`  ${e.event_type.padEnd(28)} ${e.c}`);

  // Risk audit + assumptions
  const ras = await sql`SELECT id, headline, lethality, certainty FROM risks WHERE project_id = ${PROJECT_ID} ORDER BY lethality DESC NULLS LAST LIMIT 10`;
  console.log(`\n(extra) risks: ${ras.length} rows`);
  for (const r of ras.slice(0,5)) console.log(`  ${r.id} | leth=${r.lethality} cert=${r.certainty} | "${(r.headline||'').slice(0,80)}"`);

  const report = {
    projectId: PROJECT_ID,
    phase2: {
      proposalsCount: allProposals.length,
      proposals: allProposals.map(p => ({ id: p.id, status: p.status, kind: p.kind, title: p.title, execution_result: p.execution_result })),
      approvalAttempts: approvals,
      monitors,
      cronStatus,
      cronBody: cronJson,
      monitorRuns: runs,
      ecosystemAlerts: alerts,
      t13,
    },
    phase3: {
      skillCompletions: sc,
      ideaCanvasFilledFieldCount: ic.length === 1 ? ['problem', 'solution', 'target_market', 'business_model', 'competitive_advantage', 'value_proposition', 'unfair_advantage'].filter(f => ic[0][f]).length : 0,
      sectionScores: ss.map(r => ({ skill_id: r.skill_id, dimensions: Object.keys(r.section_scores || {}) })),
      projectScores: projScores,
      monitorsCount: monitors.length,
      monitorRunsCount: runs.length,
      ecosystemAlertsCount: alerts.length,
      configMonitorActionsCount: pa.length,
      graphNodesBreakdown: gn,
      llmTotalCost: llm[0].sum_cost,
      llmRows: llm[0].c,
      memoryFacts: facts,
      memoryEvents: events,
    },
  };
  fs.writeFileSync('/tmp/founder-sim-phase23-report.json', JSON.stringify(report, null, 2));
  console.log(`\nWrote → /tmp/founder-sim-phase23-report.json`);

  await sql.end({ timeout: 5 });
}

main().catch(async (err) => { console.error('FATAL:', err); await sql.end({ timeout: 5 }); process.exit(1); });
