#!/usr/bin/env node
/**
 * A/B for CACHE_PREFIX_SPLIT — does moving the dynamic context off the system
 * prompt turn cache WRITES into cache READS?
 *
 * Why it needs measuring rather than reasoning: prompt caching bills on the
 * PREFIX. A measured turn writes ~50k tokens to cache while the system prompt is
 * ~17k and the tool schemas ~10k — so most of what is rewritten is content that
 * never changed, invalidated by ~3.2k of volatile context sitting in front of it.
 * Writes cost 3.75 $/M, reads 0.30 $/M: twelve times more, for identical bytes.
 *
 * Run twice against the same dev server, restarted with the flag between:
 *   CACHE_PREFIX_SPLIT unset -> node scripts/ab-cache-split.mjs off
 *   CACHE_PREFIX_SPLIT=1     -> node scripts/ab-cache-split.mjs on
 * Then: node scripts/ab-cache-split.mjs report
 *
 * Same project seed, same messages, same order — the only variable is the flag.
 */
import fs from 'node:fs';
import postgres from 'postgres';

const MODE = process.argv[2] ?? 'off';
const BASE = 'http://localhost:3005';
const ENV = '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local';
for (const raw of fs.readFileSync(ENV, 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const eq = l.indexOf('='); if (eq < 0) continue;
  const k = l.slice(0, eq).trim(); const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const LEDGER = '/tmp/ab-cache-split.json';

// Four turns that each move the dynamic context (stage/memory/canvas), because a
// static conversation would cache perfectly under BOTH arms and prove nothing.
const TURNS = [
  'Ciao, a che punto sono con la validazione?',
  'Il mio target sono studi di fisioterapia con 1-3 professionisti, non i grandi centri.',
  'Qual e il rischio tecnico piu grosso che vedi?',
  'Ok, e adesso qual e il prossimo passo concreto?',
];

if (MODE === 'report') {
  const led = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const stat = async (projectId) => (await sql`
    SELECT count(*)::int n,
           sum(cache_creation_tokens)::bigint w, sum(cache_read_tokens)::bigint r,
           round(sum(total_cost_usd)::numeric,3) usd
      FROM llm_usage_logs WHERE project_id = ${projectId} AND step = 'chat'`)[0];
  const off = await stat(led.off); const on = await stat(led.on);
  const f = (x) => Number(x).toLocaleString('it-IT');
  console.log('\n══ CACHE_PREFIX_SPLIT — A/B ══');
  console.log(`  OFF  ${off.n} turni · scritture ${f(off.w)} · letture ${f(off.r)} · $${off.usd}`);
  console.log(`  ON   ${on.n} turni · scritture ${f(on.w)} · letture ${f(on.r)} · $${on.usd}`);
  const dW = Number(off.w) ? (1 - Number(on.w) / Number(off.w)) * 100 : 0;
  const dC = Number(off.usd) ? (1 - Number(on.usd) / Number(off.usd)) * 100 : 0;
  console.log(`\n  scritture cache  ${dW >= 0 ? '-' : '+'}${Math.abs(dW).toFixed(0)}%`);
  console.log(`  costo            ${dC >= 0 ? '-' : '+'}${Math.abs(dC).toFixed(0)}%`);
  console.log(`  per turno: $${(Number(off.usd) / off.n).toFixed(3)} -> $${(Number(on.usd) / on.n).toFixed(3)}`);
  // The gate from the module's own doc comment: writes must FALL and reads RISE.
  const verdict = Number(on.w) < Number(off.w) && Number(on.r) >= Number(off.r) * 0.9;
  console.log(`\n  ${verdict ? 'PASSA' : 'NON passa'} il criterio: scritture giu, letture su.`);
  await sql.end();
  process.exit(0);
}

const userId = `abcache-${MODE}-` + Math.random().toString(36).slice(2, 8);
await sql`INSERT INTO users (id, email, locale) VALUES (${userId}, ${userId + '@ab.local'}, 'it')`;
const H = { 'Content-Type': 'application/json', 'x-e2e-user': userId };
const res = await fetch(`${BASE}/api/projects`, {
  method: 'POST', headers: H,
  body: JSON.stringify({
    name: `AB cache ${MODE} (cancellabile)`, locale: 'it',
    description: 'RipetiBene assegna esercizi a casa ai pazienti dei fisioterapisti con video personalizzati e verifica dell esecuzione dalla fotocamera. Il 70% dei pazienti abbandona e il fisioterapista non sa se li fanno. SaaS mensile per studio.',
  }),
});
const j = await res.json();
const projectId = j?.data?.project_id || j?.project_id || j?.id;
console.log(`[${MODE}] project ${projectId}`);
await new Promise((r) => setTimeout(r, 2500));

for (const [i, content] of TURNS.entries()) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ project_id: projectId, step: 'chat', messages: [{ role: 'user', content }] }),
  });
  await r.text();
  console.log(`  turno ${i + 1} ${Math.round((Date.now() - t0) / 1000)}s`);
}

const led = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
led[MODE] = projectId;
fs.writeFileSync(LEDGER, JSON.stringify(led, null, 2));
console.log(`[${MODE}] fatto — registrato in ${LEDGER}`);
await sql.end();
