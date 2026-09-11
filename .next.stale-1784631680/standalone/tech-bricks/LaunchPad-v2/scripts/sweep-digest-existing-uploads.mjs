#!/usr/bin/env node
/**
 * Retro-digest sweep — run the document digest across EVERY existing uploaded
 * document that hasn't been digested yet, so brownfield founders who uploaded
 * before the digest flow existed get their journey pre-filled too.
 *
 * Idempotent-ish: skips uploads that already produced a document_digested
 * event (matched by fact_id in the event payload). Runs the REAL digest via the
 * HTTP endpoint against a running server (so it shares the app's LLM + staging
 * rails). Server must be up with E2E auth (E2E_AUTH_ENABLED=1).
 *
 * Usage:  node scripts/sweep-digest-existing-uploads.mjs [--dry] [--base http://localhost:3001]
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const DRY = process.argv.includes('--dry');
const baseIdx = process.argv.indexOf('--base');
const BASE = baseIdx >= 0 ? process.argv[baseIdx + 1] : 'http://localhost:3001';
const UID = 'cb05a0ea-720c-4795-b582-5b013e8f7572';

for (const raw of fs.readFileSync(path.join('/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2', '.env.local'), 'utf8').split('\n')) {
  const l = raw.trim(); if (!l || l.startsWith('#')) continue;
  const e = l.indexOf('='); if (e < 0) continue;
  const k = l.slice(0, e).trim(), v = l.slice(e + 1).trim().replace(/^['"]|['"]$/g, '');
  if (!(k in process.env)) process.env[k] = v;
}
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

async function main() {
  // Uploads with NO document_digested event referencing their fact id.
  const rows = await sql`
    SELECT f.id, f.project_id
      FROM memory_facts f
     WHERE f.kind = 'file_upload'
       AND NOT EXISTS (
         SELECT 1 FROM memory_events e
          WHERE e.project_id = f.project_id
            AND e.event_type = 'document_digested'
            AND e.payload->>'fact_id' = f.id
       )
     ORDER BY f.created_at`;
  console.log(`${rows.length} undigested uploads across ${new Set(rows.map(r => r.project_id)).size} projects${DRY ? ' (dry)' : ''}`);

  let ok = 0, staged = 0, watchers = 0, failed = 0;
  for (const r of rows) {
    if (DRY) { ok++; continue; }
    try {
      const res = await fetch(`${BASE}/api/projects/${r.project_id}/knowledge/digest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-e2e-user': UID },
        body: JSON.stringify({ fact_id: r.id }),
      });
      const body = await res.json().catch(() => null);
      const d = body?.data?.results?.[0] ?? body?.results?.[0];
      if (res.ok && d) { ok++; staged += d.staged_items ?? 0; watchers += d.watcher_proposals ?? 0; }
      else { failed++; console.warn(`  ✗ ${r.id} (${r.project_id}): ${res.status} ${JSON.stringify(body).slice(0, 120)}`); }
    } catch (e) { failed++; console.warn(`  ✗ ${r.id}: ${e.message}`); }
  }
  console.log(DRY ? '[dry] nothing digested' : `digested ${ok} | staged ${staged} items | ${watchers} watcher proposals | ${failed} failed`);
  await sql.end();
}
main().catch(async (e) => { console.error('FATAL', e.message); try { await sql.end(); } catch {} process.exit(1); });
