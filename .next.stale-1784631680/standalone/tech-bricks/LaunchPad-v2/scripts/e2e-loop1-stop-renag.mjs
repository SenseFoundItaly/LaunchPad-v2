#!/usr/bin/env node
// E2E audit — lost-STOP-verdict re-nag (2026-07-11 gap audit LOW→fix).
// A founder records a STOP verdict; the verdict lands on validation_loops but
// the loop1_verdict memory_event write FAILS (simulated here by not creating
// it). The next weak interview fires the auto-trigger. The guard must read the
// DECISION (the loop row), not the event: a new Loop-1 proposal for an idea
// the founder already shelved contradicts a recorded founder decision.
//
// Run: E2E_AUTH_ENABLED=1 dev server on :3005, then node scripts/e2e-loop1-stop-renag.mjs
import fs from 'node:fs';
import postgres from 'postgres';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
for (const raw of fs.readFileSync('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'e2e-stopn-' + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}
const seedInterview = (pid, i) => sql`
  INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, urgency, wtp_amount, conducted_at)
  VALUES (${'iv_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${uid}, ${'Person ' + i}, ${'summary ' + i},
          ${'they lose hours'}, ${'high'}, ${i === 0 ? 50 : null}, NOW())`;
const openLoops = (pid) => sql`SELECT id, status, trigger FROM validation_loops WHERE project_id=${pid} AND status IN ('proposed','active','in_review')`;

(async () => {
  await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@e2e.local'}, 'en')`;
  const pr = await api('POST', '/api/projects', { name: 'Loop1 STOP re-nag E2E', locale: 'en', description: 'AI video analysis for amateur sports clubs.' });
  const pid = pr.json?.data?.project_id;

  // Fully-GREEN Stage 2 so the gate is 'done' and the auto-trigger is armed.
  await sql`UPDATE idea_canvas SET problem='Clubs lose hours on manual video review.', solution='AI cameras', target_market='Amateur clubs', value_proposition='Pro analysis at amateur prices', competitive_advantage='Turnkey hardware', business_model='Monthly SaaS', channels='Federations' WHERE project_id=${pid}`;
  if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid}`).length === 0)
    await sql`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels) VALUES (${pid},'Clubs lose hours on manual video review.','AI cameras','Amateur clubs','Pro analysis at amateur prices','Turnkey hardware','Monthly SaaS','Federations')`;
  await sql`INSERT INTO research (project_id, market_size) VALUES (${pid}, ${sql.json({ approved: true, tam: '€40M', sam: '€16M' })}) ON CONFLICT (project_id) DO UPDATE SET market_size=EXCLUDED.market_size`;
  for (const n of ['Veo', 'Pixellot', 'Trace']) await sql`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state) VALUES (${'g_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${n}, 'competitor', 'x', 'applied')`;
  for (const f of ['Feasibility: computer vision is technically possible with today\'s tools', 'Key dependencies: camera suppliers and vision models', 'Regulatory: GDPR for filmed minors', 'Unlike Veo we are turnkey'])
    await sql`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, reviewed_state) VALUES (${'mf_' + Math.random().toString(36).slice(2, 10)}, ${uid}, ${pid}, ${f}, 'observation', 'applied')`;
  await sql`INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status) VALUES (${'ws_' + Math.random().toString(36).slice(2, 10)}, ${pid}, 'https://example.com', 'Competitor watch', 'competitor_product', 'weekly', 'active')`;
  for (let i = 0; i < 6; i++) await seedInterview(pid, i); // 1/6 WTP = 17% < 30%

  // The DECIDED end state: a closed loop with a founder STOP verdict on the
  // row — but NO loop1_verdict memory_event (the write failed).
  await sql`INSERT INTO validation_loops (id, project_id, loop_number, iteration, status, trigger, verdict, closed_at)
    VALUES (${'loop_stopn_' + Math.random().toString(36).slice(2, 8)}, ${pid}, 1, 3, 'closed', 'auto', 'STOP', NOW())`;
  const ev = await sql`SELECT 1 FROM memory_events WHERE project_id=${pid} AND event_type='loop1_verdict'`;
  ok('setup: STOP verdict on the loop row, loop1_verdict event MISSING', ev.length === 0);

  // Fire the auto-trigger with one more weak interview.
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 7', summary: 's', top_pain: 'lose hours', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1500));

  const open = await openLoops(pid);
  ok('NO new Loop-1 proposed for the shelved idea (decision honored)', open.length === 0,
    open.length ? `RE-NAG: new loop ${open[0].id} status=${open[0].status}` : 'no open loop');

  await sql`DELETE FROM projects WHERE id=${pid}`; await sql`DELETE FROM users WHERE id=${uid}`;
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
