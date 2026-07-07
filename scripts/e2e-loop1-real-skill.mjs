#!/usr/bin/env node
// Closes the loop-1 e2e shortcut: instead of simulating "founder approves the
// PSF review" with a SQL update, APPLY the real run_skill(psf-review)
// pending_action through the actions endpoint — runs the REAL psf-review LLM
// skill — and assert it completed AND the loop transitioned to 'active'.
import fs from 'node:fs';
import postgres from 'postgres';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3010';
for (const raw of fs.readFileSync('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'e2e-lps-' + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { console.log(`${c ? '✓' : '✗'} ${n}${x ? ' — ' + x : ''}`); c ? pass++ : fail++; };
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}
(async () => {
  console.log(`loop1 REAL-skill e2e  base=${BASE}  user=${uid}`);
  await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@e2e.local'}, 'it')`;
  const pr = await api('POST', '/api/projects', { name: 'Loop1 RealSkill', locale: 'it', description: 'AI video analysis for amateur sports clubs.' });
  const pid = pr.json?.data?.project_id;
  await sql`UPDATE idea_canvas SET problem='I club dilettantistici perdono ore con la revisione video manuale e non possono permettersi pro.', solution='Telecamere AI edge', target_market='Club dilettantistici italiani', value_proposition='Analisi pro a prezzo amatoriale', competitive_advantage='Hardware chiavi in mano', business_model='SaaS mensile', channels='Federazioni' WHERE project_id=${pid}`;
  if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid}`).length === 0)
    await sql`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model, channels) VALUES (${pid},'I club dilettantistici perdono ore con la revisione video manuale.','Telecamere AI edge','Club dilettantistici italiani','Analisi pro a prezzo amatoriale','Hardware chiavi in mano','SaaS mensile','Federazioni')`;
  await sql`INSERT INTO research (project_id, market_size) VALUES (${pid}, ${sql.json({ approved: true, tam: '€40M', sam: '€16M' })}) ON CONFLICT (project_id) DO UPDATE SET market_size=EXCLUDED.market_size`;
  for (const n of ['Veo', 'Pixellot', 'Trace']) await sql`INSERT INTO graph_nodes (id, project_id, name, node_type, summary, reviewed_state) VALUES (${'g_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${n}, 'competitor', 'x', 'applied')`;
  for (const f of ['Feasibility: computer vision tecnicamente possibile', 'Key dependencies: fornitori di camere e modelli di visione', 'Regulatory: GDPR per i minori ripresi', 'A differenza di Veo siamo chiavi in mano'])
    await sql`INSERT INTO memory_facts (id, user_id, project_id, fact, kind, reviewed_state) VALUES (${'mf_' + Math.random().toString(36).slice(2, 10)}, ${uid}, ${pid}, ${f}, 'observation', 'applied')`;
  await sql`INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status) VALUES (${'ws_' + Math.random().toString(36).slice(2, 10)}, ${pid}, 'https://example.com', 'Watch', 'competitor_product', 'weekly', 'active')`;
  // 6 interviews with detail (for the skill to reason over), only 1 with WTP.
  for (let i = 0; i < 6; i++) await sql`INSERT INTO interviews (id, project_id, user_id, person_name, summary, top_pain, urgency, wtp_amount, conducted_at) VALUES (${'iv_' + Math.random().toString(36).slice(2, 10)}, ${pid}, ${uid}, ${'Allenatore ' + i}, ${'Vorrebbe gli highlight ma il budget del club è quasi zero'}, ${'perde ore a montare i video a mano'}, ${'media'}, ${i === 0 ? 40 : null}, NOW())`;

  // Trigger the loop.
  await api('POST', `/api/projects/${pid}/interviews`, { person_name: 'Allenatore 7', summary: 'poco budget', top_pain: 'monta a mano', urgency: 'media' });
  await new Promise((r) => setTimeout(r, 1500));
  const loop = (await sql`SELECT id, pending_action_id FROM validation_loops WHERE project_id=${pid} AND status='proposed' LIMIT 1`)[0];
  ok('Loop 1 proposed', !!loop);
  const paId = loop?.pending_action_id;

  console.log('  applying the run_skill(psf-review) proposal — running the REAL skill (may take 30-150s)…');
  const applyRes = await api('POST', `/api/projects/${pid}/actions/${paId}`, { transition: 'apply' });
  ok('apply transition returned 200', applyRes.status === 200, `status=${applyRes.status}`);

  // The psf-review skill actually ran → skill_completions row + loop is 'active'.
  const comp = await sql`SELECT skill_id, left(summary,120) AS s FROM skill_completions WHERE project_id=${pid} AND skill_id='psf-review' ORDER BY completed_at DESC LIMIT 1`;
  ok('psf-review skill actually ran (skill_completions row)', comp.length === 1, comp[0]?.s || 'none');
  const loopNow = (await sql`SELECT status FROM validation_loops WHERE id=${loop.id}`)[0];
  ok('loop transitioned to active after the real review ran', loopNow?.status === 'active', `status=${loopNow?.status}`);
  // The skill output is a real founder-facing analysis (non-trivial length).
  ok('psf-review produced a substantive analysis', (comp[0]?.s || '').length > 40, `${(comp[0]?.s || '').length} chars (head)`);

  await sql`DELETE FROM projects WHERE id=${pid}`; await sql`DELETE FROM users WHERE id=${uid}`;
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
