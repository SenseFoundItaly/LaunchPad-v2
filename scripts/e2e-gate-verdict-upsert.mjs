#!/usr/bin/env node
/**
 * Deterministic e2e for the gate-verdict upsert fix: most projects have NO
 * `research` row, and the old bare UPDATE silently matched 0 rows — the
 * founder's GO/PIVOT/STOP returned 200 but persisted NOTHING, leaving the
 * Stage-2 gate_verdict check red forever. Verifies on a throwaway project
 * (which, being fresh, has no research row — the exact failing state):
 *   1. POST /gate-verdict {STOP, motivation} → 200 AND research.gate_verdict
 *      actually persisted (row created by the upsert);
 *   2. DELETE /gate-verdict → cleared.
 * STOP is used because it is legal at any time (GO requires complete gate
 * evidence, unreachable deterministically). No LLM turns.
 * Run: E2E_AUTH_ENABLED=1 dev server on :3005, then
 *   node scripts/e2e-gate-verdict-upsert.mjs
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
const userId = 'e2e-gateverdict-' + Math.random().toString(36).slice(2, 10);
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
    name: 'GateVerdict E2E', locale: 'it',
    description: 'Progetto throwaway per verificare la persistenza del gate verdict senza research row.',
  });
  projectId = pr.json?.data?.project_id || pr.json?.project_id || pr.json?.id;
  console.log(`project ${projectId} user ${userId}`);
  if (!projectId) throw new Error(`project create failed: ${JSON.stringify(pr)}`);

  const pre = await sql`SELECT project_id FROM research WHERE project_id = ${projectId}`;
  check('fresh project has no research row (the failing precondition)', pre.length === 0, `rows=${pre.length}`);

  const post = await api('POST', `/api/projects/${projectId}/gate-verdict`, {
    verdict: 'STOP', motivation: 'e2e: verifica upsert senza research row',
  });
  check('POST gate-verdict returns 200', post.status === 200, `status=${post.status} body=${JSON.stringify(post.json ?? post.text)}`);

  const after = await sql`SELECT gate_verdict FROM research WHERE project_id = ${projectId}`;
  const gv = after[0]?.gate_verdict;
  check('research row was created and gate_verdict persisted (was: silent 0-row UPDATE)',
    !!gv && gv.verdict === 'STOP', JSON.stringify(after));

  const del = await api('DELETE', `/api/projects/${projectId}/gate-verdict`);
  const cleared = await sql`SELECT gate_verdict FROM research WHERE project_id = ${projectId}`;
  check('DELETE clears the verdict (reversibility preserved)',
    del.status === 200 && cleared[0]?.gate_verdict == null, JSON.stringify(cleared));
} finally {
  if (projectId) await sql`DELETE FROM research WHERE project_id = ${projectId}`;
  if (projectId) await sql`DELETE FROM projects WHERE id = ${projectId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql.end();
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
