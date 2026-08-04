#!/usr/bin/env node
/**
 * Deterministic e2e for the soft-canvas commit fix (Luca / LocalPulse class):
 * a chat "close the canvas" commit carries cost_structure / revenue_streams /
 * key_metrics as prose STRINGS and may carry NO core field. Verifies:
 *   1. POST /idea-canvas with ONLY soft-field strings → 201 (was 400) and
 *      `applied` lists the three fields;
 *   2. GET /idea-canvas returns them as arrays;
 *   3. after the core fields land too, GET /stages shows cost_revenue_defined
 *      and lean_canvas_compiled passed (Stage 1 completable, Validation next).
 * No LLM turns. Run: E2E_AUTH_ENABLED=1 dev server on :3005, then
 *   node scripts/e2e-soft-canvas-commit.mjs
 * ⚠️ dev==prod: creates a throwaway user+project and deletes them at the end.
 */
import fs from 'node:fs';
import postgres from 'postgres';

const BASE = 'http://localhost:3005';
const ENV = '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local';
for (const raw of fs.readFileSync(ENV, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const userId = 'e2e-softcanvas-' + Math.random().toString(36).slice(2, 10);
let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ← ${detail}`}`);
  if (!ok) failures++;
};

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { 'Content-Type': 'application/json', 'x-e2e-user': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

let projectId;
try {
  await sql`INSERT INTO users (id, email, locale) VALUES (${userId}, ${userId + '@e2e.local'}, 'it')`;
  const pr = await api('POST', '/api/projects', {
    name: 'SoftCanvas E2E', locale: 'it',
    description: 'Progetto throwaway per verificare il commit dei campi soft del canvas.',
  });
  projectId = pr.json?.data?.project_id || pr.json?.project_id || pr.json?.id;
  console.log(`project ${projectId} user ${userId}`);
  if (!projectId) throw new Error(`project create failed: ${JSON.stringify(pr)}`);

  // 1 — soft-only commit, prose strings (the exact LocalPulse payload class)
  const soft = await api('POST', `/api/projects/${projectId}/idea-canvas`, {
    revenue_streams: 'Abbonamento mensile per agente attivo + vendita di report premium su zone specifiche',
    cost_structure: 'Dati/cloud (fisso), sviluppo prodotto (principale), acquisizione clienti (variabile)',
    key_metrics: 'MRR, nuovi studi/mese, agenti attivi settimanali, retention mensile',
  });
  check('soft-only POST returns 201 (was 400)', soft.status === 201, `status=${soft.status} body=${JSON.stringify(soft.json ?? soft.text)}`);
  const applied = soft.json?.data?.applied ?? soft.json?.applied ?? [];
  check('applied lists the 3 soft fields',
    ['cost_structure', 'revenue_streams', 'key_metrics'].every((k) => applied.includes(k)),
    `applied=${JSON.stringify(applied)}`);

  // 2 — canvas returns them as arrays
  const canvas = await api('GET', `/api/projects/${projectId}/idea-canvas`);
  const c = canvas.json?.data ?? canvas.json ?? {};
  check('cost_structure persisted as non-empty array', Array.isArray(c.cost_structure) && c.cost_structure.length > 0, JSON.stringify(c.cost_structure));
  check('revenue_streams persisted as non-empty array', Array.isArray(c.revenue_streams) && c.revenue_streams.length > 0, JSON.stringify(c.revenue_streams));
  check('key_metrics persisted as non-empty array', Array.isArray(c.key_metrics) && c.key_metrics.length > 0, JSON.stringify(c.key_metrics));

  // 3 — fill the core blocks (mixed commit incl. an array-form soft field),
  //     then the Stage-1 canvas checks must be green
  const core = await api('POST', `/api/projects/${projectId}/idea-canvas`, {
    problem: 'Gli agenti immobiliari non sanno quali zone si stanno muovendo prima dei competitor.',
    solution: 'Radar di zona con segnali di domanda in tempo reale.',
    target_market: 'Studi immobiliari indipendenti italiani (2-15 agenti).',
    value_proposition: 'Sapere dove si muove il mercato una settimana prima degli altri.',
    business_model: 'SaaS mensile per agente attivo.',
    competitive_advantage: 'Dataset proprietario di segnali locali.',
    channels: 'Vendita diretta agli studi + passaparola di categoria.',
    unfair_advantage: 'Rete di segnalatori locali già attiva.',
  });
  check('core POST returns 201', core.status === 201, `status=${core.status}`);

  const stages = await api('GET', `/api/projects/${projectId}/stages`);
  const evals = stages.json?.data?.evaluations ?? stages.json?.evaluations ?? [];
  const s1 = evals.find((s) => s.stage?.id === 'idea_validation' || s.stage?.number === 1) ?? {};
  const byId = (id) => (s1.results ?? []).find((r) => r.check?.id === id)?.result ?? {};
  check('cost_revenue_defined check is green', byId('cost_revenue_defined').passed === true, JSON.stringify(byId('cost_revenue_defined')));
  check('lean_canvas_compiled check is green', byId('lean_canvas_compiled').passed === true, JSON.stringify(byId('lean_canvas_compiled')));
  console.log(`  stage1 ${s1.passed}/${s1.total} status=${s1.status}`);
} finally {
  if (projectId) await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql.end();
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
