#!/usr/bin/env node
// E2E proof — Loop 1 Founder-first ESCAPE (linee guida §4: "il sistema non può
// bloccare il founder"). Seed a Stage-2-complete project, trigger the loop with
// weak WTP, then DISMISS the PSF-review proposal → assert the loop releases
// (ignore-with-motivation), Phase 2 unblocks, and the auto-trigger does NOT
// re-nag. Covers the exact dead-end the re-audit found (reject left the loop
// 'proposed' → Phase 2 gated forever).
//
// Run: E2E_AUTH_ENABLED=1 dev server on :3005, then node scripts/e2e-loop1-escape.mjs
import fs from 'node:fs';
import postgres from 'postgres';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
for (const raw of fs.readFileSync('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'e2e-lesc-' + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}
const gated = (r) => r.json?.data?.gated || r.json?.gated || [];
const seedInterview = (pid, i, withWtp) => sql`
  INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, urgency, wtp_amount, conducted_at)
  VALUES (${'iv_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${uid}, ${'Person ' + i}, ${'summary ' + i},
          ${'they lose hours'}, ${'high'}, ${withWtp ? 50 : null}, NOW())`;
const openLoop = (pid) => sql`SELECT id, status FROM validation_loops WHERE project_id=${pid} AND status IN ('proposed','active','in_review') ORDER BY created_at DESC LIMIT 1`;

(async () => {
  await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@e2e.local'}, 'it')`;
  const pr = await api('POST', '/api/projects', { name: 'Loop1 Escape E2E', locale: 'it', description: 'AI video analysis for amateur sports clubs.' });
  const pid = pr.json?.data?.project_id;

  // Fully-GREEN Stage 2 so the gate is 'done' and Loop 1 can fire.
  await sql`UPDATE idea_canvas SET problem='I club perdono ore con la revisione video manuale.', solution='Telecamere AI', target_market='Club dilettantistici', value_proposition='Analisi pro a prezzo amatoriale', competitive_advantage='Hardware chiavi in mano', business_model='SaaS mensile', channels='Federazioni' WHERE project_id=${pid}`;
  if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid}`).length === 0)
    await sql`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels) VALUES (${pid},'I club perdono ore con la revisione video manuale.','Telecamere AI','Club dilettantistici','Analisi pro a prezzo amatoriale','Hardware chiavi in mano','SaaS mensile','Federazioni')`;
  await sql`INSERT INTO research (project_id, market_size) VALUES (${pid}, ${sql.json({ approved: true, tam: '€40M', sam: '€16M' })}) ON CONFLICT (project_id) DO UPDATE SET market_size=EXCLUDED.market_size`;
  for (const n of ['Veo', 'Pixellot', 'Trace']) await sql`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state) VALUES (${'g_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${n}, 'competitor', 'x', 'applied')`;
  for (const f of ['Feasibility: computer vision tecnicamente possibile con gli strumenti di oggi', 'Key dependencies: fornitori di camere e modelli di visione', 'Regulatory: GDPR per i minori ripresi', 'A differenza di Veo siamo chiavi in mano'])
    await sql`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, reviewed_state) VALUES (${'mf_' + Math.random().toString(36).slice(2, 10)}, ${uid}, ${pid}, ${f}, 'observation', 'applied')`;
  await sql`INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status) VALUES (${'ws_' + Math.random().toString(36).slice(2, 10)}, ${pid}, 'https://example.com', 'Competitor watch', 'competitor_product', 'weekly', 'active')`;
  for (let i = 0; i < 6; i++) await seedInterview(pid, i, i === 0); // 1/6 WTP = 17% < 30%

  // Trigger the loop (7th weak interview).
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 7', summary: 's', top_pain: 'lose hours', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1500));
  const loop = (await openLoop(pid))[0];
  ok('Loop 1 auto-proposed on weak WTP', !!loop && loop.status === 'proposed', loop ? `status=${loop.status}` : 'none');
  const paId = loop ? (await sql`SELECT pending_action_id FROM validation_loops WHERE id=${loop.id}`)[0].pending_action_id : null;
  ok('Phase-2 (business-model) gated while loop open', gated(await api('GET', `/api/projects/${pid}/skills?availability=1`)).includes('business-model'));

  // ── FOUNDER-FIRST ESCAPE: dismiss the PSF-review proposal with a motivation ──
  const rej = await api('POST', `/api/projects/${pid}/actions/${paId}`, { transition: 'reject', reason: 'Sono sicuro del fit, procedo al pricing' });
  ok('reject transition succeeded', rej.status === 200, `status=${rej.status}`);
  const after = (await sql`SELECT status, override_motivation FROM validation_loops WHERE id=${loop.id}`)[0];
  ok('loop RELEASED as closed with the founder motivation', after.status === 'closed' && (after.override_motivation || '').includes('procedo'), `status=${after.status}`);
  ok('no open loop remains', (await openLoop(pid)).length === 0);
  ok('Phase-2 (business-model) UNBLOCKED after dismiss', !gated(await api('GET', `/api/projects/${pid}/skills?availability=1`)).includes('business-model'));

  // The auto-trigger must NOT re-nag after an ignore-with-motivation.
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 8', summary: 's', top_pain: 'lose hours', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1200));
  ok('no re-nag after override (loop stays closed)', (await openLoop(pid)).length === 0);

  await sql`DELETE FROM projects WHERE id=${pid}`; await sql`DELETE FROM users WHERE id=${uid}`;
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
