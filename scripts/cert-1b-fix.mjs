#!/usr/bin/env node
// Focused proof: technical-validation now stages an approve-to-green 1B card
// even when the model emits prose (cert-found gap). Seed applied canvas → run
// technical-validation → assert a validation_proposal with tech_fact items →
// apply it → assert the three 1B checks go green.
import fs from 'node:fs';
import postgres from 'postgres';
const BASE = 'http://localhost:3005';
for (const raw of fs.readFileSync('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local', 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const uid = 'cert1b-' + Math.random().toString(36).slice(2, 8);
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`); cond ? pass++ : fail++; };
async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: body ? JSON.stringify(body) : undefined });
  const t = await res.text(); try { return { status: res.status, json: JSON.parse(t) }; } catch { return { status: res.status, text: t }; }
}
async function stream(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': uid }, body: JSON.stringify(body) });
  if (!res.ok) return { error: `${res.status}: ${await res.text()}` };
  const rd = res.body.getReader(); const dec = new TextDecoder(); let buf = '', done = null;
  while (true) { const { value, done: d } = await rd.read(); if (d) break; buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop() ?? '';
    for (const ln of lines) { if (!ln.startsWith('data: ')) continue; try { const p = JSON.parse(ln.slice(6)); if (p.done) done = p; } catch {} } }
  return { done };
}
(async () => {
  await sql`INSERT INTO users (id, email, locale) VALUES (${uid}, ${uid + '@cert.local'}, 'it')`;
  const pr = await api('POST', '/api/projects', { name: 'Cert1B', locale: 'it', description: 'Piattaforma AI per analisi video sportiva dei club dilettantistici italiani. Telecamere edge con computer vision on-device.' });
  const pid = pr.json?.data?.project_id;
  // Applied canvas so the 1B skill's prereqs pass.
  await sql`UPDATE idea_canvas SET
    problem='I club dilettantistici non hanno analisi video accessibile.',
    solution='Telecamere AI edge che generano highlight e statistiche automatiche.',
    target_market='Club calcistici dilettantistici italiani.',
    value_proposition='Analisi pro a prezzo amatoriale, senza operatore.',
    competitive_advantage='Hardware chiavi in mano e dataset proprietario.',
    business_model='Abbonamento SaaS mensile.' WHERE project_id=${pid}`;
  if ((await sql`SELECT 1 FROM idea_canvas WHERE project_id=${pid}`).length === 0)
    await sql`INSERT INTO idea_canvas (project_id, problem, solution, target_market, value_proposition, competitive_advantage, business_model) VALUES (${pid},'I club dilettantistici non hanno analisi video accessibile.','Telecamere AI edge che generano highlight e statistiche.','Club calcistici dilettantistici italiani.','Analisi pro a prezzo amatoriale.','Hardware chiavi in mano e dataset proprietario.','Abbonamento SaaS mensile.')`;

  console.log('running technical-validation…');
  const tv = await stream(`/api/projects/${pid}/skills`, { skill_id: 'technical-validation', run: true });
  ok('technical-validation completed', tv.done?.status === 'completed', `artifacts=${tv.done?.artifacts_persisted}`);

  const props = await sql`SELECT id, title, payload, status FROM pending_actions WHERE project_id=${pid} AND action_type='validation_proposal' ORDER BY created_at DESC`;
  const techCard = props.find((p) => {
    const items = (typeof p.payload === 'string' ? JSON.parse(p.payload) : p.payload)?.items || [];
    return items.some((it) => it.kind === 'tech_fact');
  });
  ok('a validation_proposal with tech_fact items was staged', !!techCard, techCard ? techCard.title : 'none');
  if (techCard) {
    const items = (typeof techCard.payload === 'string' ? JSON.parse(techCard.payload) : techCard.payload).items;
    const fields = items.filter((i) => i.kind === 'tech_fact').map((i) => i.field);
    ok('card covers feasibility + dependencies + regulatory', ['feasibility', 'dependencies', 'regulatory'].every((f) => fields.includes(f)), fields.join(','));

    const b1bOf = (body) => {
      const ev = (body.json?.data?.evaluations || []).find((e) => e.stage?.id === 'market_validation');
      return (ev?.results || []).filter((r) => r.check?.track === '1B');
    };
    // 1B checks RED before approval
    const b1b = b1bOf(await api('GET', `/api/projects/${pid}/stages`));
    ok('1B checks RED before approval', b1b.length === 3 && b1b.every((r) => !r.result?.passed), `${b1b.filter((r) => r.result?.passed).length}/${b1b.length} green`);

    // Approve
    const applyRes = await api('POST', `/api/projects/${pid}/actions/${techCard.id}`, { transition: 'apply' });
    console.log('  apply status', applyRes.status, JSON.stringify(applyRes.json?.data ?? applyRes.json ?? applyRes.text).slice(0, 200));
    await new Promise((r) => setTimeout(r, 1500));
    const facts = await sql`SELECT reviewed_state, kind, left(fact, 70) AS f FROM memory_facts WHERE project_id=${pid} ORDER BY created_at DESC LIMIT 6`;
    console.log('  memory_facts after apply:', facts.map((f) => `[${f.reviewed_state}/${f.kind}] ${f.f}`).join(' | ') || 'NONE');
    const a1b = b1bOf(await api('GET', `/api/projects/${pid}/stages`));
    const green = a1b.filter((r) => r.result?.passed);
    ok('all three 1B checks GREEN after approval', a1b.length === 3 && green.length === 3, `${green.length}/${a1b.length} green: ${green.map((r) => r.check?.id).join(',')}`);
  }

  await sql`DELETE FROM projects WHERE id=${pid}`; await sql`DELETE FROM users WHERE id=${uid}`;
  await sql.end();
  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} (${pass} passed, ${fail} failed)`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(async (e) => { console.error('ERROR:', e.message); try { await sql.end(); } catch {} process.exit(1); });
