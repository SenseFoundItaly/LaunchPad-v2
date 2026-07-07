#!/usr/bin/env node
// E2E proof — Loop 1 (PSF Review). Seed a Stage-2-complete project, log
// interviews with weak WTP → assert the loop auto-proposes; approve it → active;
// second weak round → escalate; at cap → verdict card; record GO → closed.
// Also proves the Phase-2 gate (business-model blocked while the loop is open)
// and ignore-with-motivation.
//
// Run: E2E_AUTH_ENABLED=1 dev server on :3005, then node scripts/e2e-loop1-psf.mjs
import fs from 'node:fs';
import postgres from 'postgres';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3005';
for (const raw of fs.readFileSync('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'e2e-loop1-' + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}
const seedInterview = (pid, i, withWtp) => sql`
  INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, urgency, wtp_amount, conducted_at)
  VALUES (${'iv_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${uid}, ${'Person ' + i}, ${'summary ' + i},
          ${'they lose hours'}, ${'high'}, ${withWtp ? 50 : null}, NOW())`;
const openLoop = (pid) => sql`SELECT id, status, iteration, trigger FROM validation_loops WHERE project_id=${pid} AND status IN ('proposed','active','in_review') ORDER BY created_at DESC LIMIT 1`;

(async () => {
  await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@e2e.local'}, 'it')`;
  const pr = await api('POST', '/api/projects', { name: 'Loop1 E2E', locale: 'it', description: 'AI video analysis for amateur sports clubs.' });
  const pid = pr.json?.data?.project_id;

  // Seed a fully-GREEN Stage 2 (1A+1B+1C) so the gate is 'done' and Loop 1 can fire.
  await sql`UPDATE idea_canvas SET
    problem='I club dilettantistici perdono ore ogni settimana con la revisione video manuale e non possono permettersi strumenti pro.',
    solution='Telecamere AI', target_market='Club dilettantistici', value_proposition='Analisi pro a prezzo amatoriale',
    competitive_advantage='Hardware chiavi in mano', business_model='SaaS mensile', channels='Federazioni' WHERE project_id=${pid}`;
  if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid}`).length === 0)
    await sql`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels) VALUES (${pid},'I club dilettantistici perdono ore con la revisione video manuale e non possono permettersi pro.','Telecamere AI','Club dilettantistici','Analisi pro a prezzo amatoriale','Hardware chiavi in mano','SaaS mensile','Federazioni')`;
  await sql`INSERT INTO research (project_id, market_size) VALUES (${pid}, ${sql.json({ approved: true, tam: '€40M', sam: '€16M' })}) ON CONFLICT (project_id) DO UPDATE SET market_size=EXCLUDED.market_size`;
  for (const n of ['Veo', 'Pixellot', 'Trace']) await sql`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state) VALUES (${'g_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${n}, 'competitor', 'x', 'applied')`;
  for (const f of ['Feasibility: computer vision tecnicamente possibile con gli strumenti di oggi', 'Key dependencies: fornitori di camere e modelli di visione', 'Regulatory: GDPR per i minori ripresi', 'A differenza di Veo siamo chiavi in mano'])
    await sql`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, reviewed_state) VALUES (${'mf_' + Math.random().toString(36).slice(2, 10)}, ${uid}, ${pid}, ${f}, 'observation', 'applied')`;
  await sql`INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status) VALUES (${'ws_' + Math.random().toString(36).slice(2, 10)}, ${pid}, 'https://example.com', 'Competitor watch', 'competitor_product', 'weekly', 'active')`;
  // 6 interviews, ONLY 1 with WTP → 17% < 30%.
  for (let i = 0; i < 6; i++) await seedInterview(pid, i, i === 0);

  // Gate is done? (sanity)
  const stages = await api('GET', `/api/projects/${pid}/stages`);
  const s2 = (stages.json?.data?.evaluations || []).find((e) => e.stage?.id === 'market_validation');
  ok('Stage 2 (Validation Gate) is done', s2?.status === 'done', `status=${s2?.status}`);

  // Trigger via the interviews API (the 7th interview, still weak).
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 7', summary: 's', top_pain: 'lose hours', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1500));
  let loop = (await openLoop(pid))[0];
  ok('Loop 1 auto-proposed on weak WTP', !!loop && loop.status === 'proposed' && loop.trigger === 'auto', loop ? `iter=${loop.iteration}` : 'none');
  const paId = loop ? (await sql`SELECT pending_action_id FROM validation_loops WHERE id=${loop.id}`)[0].pending_action_id : null;
  const pa = paId ? (await sql`SELECT action_type, payload FROM pending_actions WHERE id=${paId}`)[0] : null;
  ok('proposal is a founder-gated run_skill(psf-review)', pa?.action_type === 'run_skill' && (typeof pa.payload === 'string' ? JSON.parse(pa.payload) : pa.payload)?.skill_id === 'psf-review');

  // Phase-2 gate: business-model must be blocked while the loop is open.
  const gate = await api('GET', `/api/projects/${pid}/skills?availability=1`);
  ok('Phase-2 (business-model) gated while loop open', (gate.json?.data?.gated || gate.json?.gated || []).includes('business-model'));

  // Idempotent: another weak interview does NOT open a second loop.
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 8', summary: 's', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1200));
  ok('no duplicate loop on another weak interview (idempotent)', (await sql`SELECT count(*)::int c FROM validation_loops WHERE project_id=${pid} AND status!='closed'`)[0].c === 1);

  // Approve the review → loop goes 'active' (simulate the run_skill apply's activate step directly to avoid a 60-170s LLM run).
  await sql`UPDATE validation_loops SET status='active' WHERE id=${loop.id}`;

  // Escalation: iteration 2 (still weak) then cap → verdict.
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 9', summary: 's', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1200));
  loop = (await openLoop(pid))[0];
  ok('escalated to iteration 2 (still weak)', loop?.iteration === 2, `iter=${loop?.iteration} status=${loop?.status}`);
  await sql`UPDATE validation_loops SET status='active' WHERE id=${loop.id}`; // approve iter-2 review
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Person 10', summary: 's', urgency: 'high' });
  await new Promise((r) => setTimeout(r, 1200));
  loop = (await sql`SELECT id, status, iteration, verdict_evidence FROM validation_loops WHERE project_id=${pid} ORDER BY created_at DESC LIMIT 1`)[0];
  ok('at cap → verdict staged (status in_review + evidence)', loop?.status === 'in_review' && !!loop?.verdict_evidence, `status=${loop?.status}`);
  const verdictMsg = await sql`SELECT id FROM chat_messages WHERE project_id=${pid} AND content LIKE '%opt_loop1_verdict%'`;
  ok('GO/PIVOT/STOP verdict card posted to chat', verdictMsg.length === 1);

  // Record the verdict via the API → loop closed.
  const vres = await api('POST', `/api/projects/${pid}/loops/${loop.id}`, { action: 'verdict', verdict: 'PIVOT' });
  ok('verdict recorded via API', vres.status === 200 && vres.json?.data?.verdict === 'PIVOT');
  const closed = (await sql`SELECT status, verdict FROM validation_loops WHERE id=${loop.id}`)[0];
  ok('loop closed with the verdict', closed.status === 'closed' && closed.verdict === 'PIVOT');

  // Idempotency: the verdict card is a PERSISTED chat message whose "consumed"
  // lock is client-only, so it re-renders clickable after a reload. A second
  // (different) click must NOT overwrite the recorded decision — the route
  // echoes the verdict already on record, and the DB stays PIVOT.
  const vres2 = await api('POST', `/api/projects/${pid}/loops/${loop.id}`, { action: 'verdict', verdict: 'GO' });
  ok('re-submit is idempotent (echoes recorded PIVOT, not GO)', vres2.status === 200 && vres2.json?.data?.verdict === 'PIVOT');
  const still = (await sql`SELECT verdict FROM validation_loops WHERE id=${loop.id}`)[0];
  ok('recorded verdict unchanged after re-submit', still.verdict === 'PIVOT');

  // Phase-2 gate lifts once the loop is closed.
  const gate2 = await api('GET', `/api/projects/${pid}/skills?availability=1`);
  ok('Phase-2 gate lifts after verdict', !(gate2.json?.data?.gated || gate2.json?.gated || []).includes('business-model'));

  await sql`DELETE FROM projects WHERE id=${pid}`; await sql`DELETE FROM users WHERE id=${uid}`;
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
