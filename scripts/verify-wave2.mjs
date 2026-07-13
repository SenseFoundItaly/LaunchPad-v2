#!/usr/bin/env node
/**
 * Wave-2 live verification.
 *  Gap 2: same web_search query twice → 2nd is a cache hit (research_cache row
 *         written; 2nd turn faster / no new provider spend).
 *  Gap 3: an "I choose: …" message → option_selected event recorded.
 *  Gap 5: hit stages GET → stage_events reflects closed checks (proj already has
 *         startup-scoring done + canvas → Stage 1 checks pass).
 */
import fs from 'node:fs'; import path from 'node:path';
import postgres from 'postgres';

const BASE = 'http://localhost:3001';
const UID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';
const PID = process.env.VERIFY_PROJECT_ID || 'proj_85c9be57-921';
for (const raw of fs.readFileSync(path.join('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2', '.env.local'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue; const e = l.indexOf('='); if (e < 0) continue;
  const k = l.slice(0, e).trim(), v = l.slice(e + 1).trim().replace(/^['"]|['"]$/g, ''); if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

async function chat(prompt) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-e2e-user': UID }, body: JSON.stringify({ project_id: PID, step: 'chat', messages: [{ role: 'user', content: prompt }] }) });
  const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '', full = '';
  while (true) { const { value, done } = await rd.read(); if (done) break; buf += dec.decode(value, { stream: true }); const ls = buf.split('\n'); buf = ls.pop() ?? ''; for (const l of ls) { if (!l.startsWith('data: ')) continue; try { const p = JSON.parse(l.slice(6)); if (typeof p.content === 'string') full += p.content; if (p.done) { rd.cancel(); return { full, ms: Date.now() - t0 }; } } catch {} } }
  return { full, ms: Date.now() - t0 };
}

async function main() {
  console.log('=== GAP 2: research cache ===');
  const q = 'Search the web for the size of the Italian prepared-meal delivery market in 2025.';
  const before = await sql`SELECT COUNT(*)::int n FROM research_cache WHERE tool='web_search'`;
  await chat(q);
  await new Promise(r => setTimeout(r, 1200));
  const midRows = await sql`SELECT COUNT(*)::int n FROM research_cache WHERE tool='web_search'`;
  console.log(`  research_cache web_search rows: ${before[0].n} → ${midRows[0].n} (a search should have cached)`);
  // Same query again → should hit cache (a fresh, recent row present, no new insert).
  await chat(q);
  await new Promise(r => setTimeout(r, 800));
  const afterRows = await sql`SELECT COUNT(*)::int n, MAX(created_at) latest FROM research_cache WHERE tool='web_search'`;
  console.log(`  after repeat query rows: ${afterRows[0].n} (cache hit = no NEW row for same query)`);
  const sample = await sql`SELECT cache_key, jsonb_array_length(sources) nsrc FROM research_cache WHERE tool='web_search' ORDER BY created_at DESC LIMIT 1`;
  console.log(`  newest cache row: key="${(sample[0]?.cache_key||'').slice(0,50)}" sources=${sample[0]?.nsrc}`);

  console.log('\n=== GAP 3: option_selected decision event ===');
  const evBefore = await sql`SELECT COUNT(*)::int n FROM memory_events WHERE project_id=${PID} AND event_type='option_selected'`;
  await chat('I choose: Focus on the Isola neighborhood first — highest density of target buyers');
  await new Promise(r => setTimeout(r, 1200));
  const evAfter = await sql`SELECT payload->>'choice' choice, created_at FROM memory_events WHERE project_id=${PID} AND event_type='option_selected' ORDER BY created_at DESC LIMIT 1`;
  const evCount = await sql`SELECT COUNT(*)::int n FROM memory_events WHERE project_id=${PID} AND event_type='option_selected'`;
  console.log(`  option_selected events: ${evBefore[0].n} → ${evCount[0].n}`);
  console.log(`  latest choice recorded: "${(evAfter[0]?.choice||'').slice(0,70)}"`);

  console.log('\n=== GAP 5: stage_events transition history ===');
  const seBefore = await sql`SELECT COUNT(*)::int n FROM stage_events WHERE project_id=${PID}`;
  const r = await fetch(`${BASE}/api/projects/${PID}/stages`, { headers: { 'x-e2e-user': UID } });
  console.log(`  stages GET → ${r.status}`);
  await new Promise(r => setTimeout(r, 1000));
  const seAfter = await sql`SELECT stage_id, check_id, from_status, to_status FROM stage_events WHERE project_id=${PID} ORDER BY occurred_at DESC LIMIT 6`;
  console.log(`  stage_events rows: ${seBefore[0].n} → (now ${seAfter.length >= seBefore[0].n ? seAfter.length + '+' : seAfter.length})`);
  for (const e of seAfter) console.log(`    ${e.stage_id}/${e.check_id ?? '(stage)'}: ${e.from_status ?? '∅'}→${e.to_status}`);
  // Idempotency: a 2nd GET with no state change should add nothing.
  await fetch(`${BASE}/api/projects/${PID}/stages`, { headers: { 'x-e2e-user': UID } });
  await new Promise(r => setTimeout(r, 800));
  const seIdem = await sql`SELECT COUNT(*)::int n FROM stage_events WHERE project_id=${PID}`;
  const seNow = await sql`SELECT COUNT(*)::int n FROM stage_events WHERE project_id=${PID}`;
  console.log(`  after 2nd GET (no change): ${seNow[0].n} rows (idempotent = unchanged)`);
  await sql.end();
}
main().catch(async e => { console.error('FATAL', e.message); try { await sql.end(); } catch {} process.exit(1); });
