/**
 * Backfill: un-double-encode the HIGH-tier JSONB columns fixed in PR1.
 *
 * A `JSON.stringify(obj)` bound to a jsonb column stored a JSON *string* scalar
 * (jsonb_typeof='string'). This re-parses those legacy rows back to objects.
 * Idempotent (guarded on jsonb_typeof='string'); safe to re-run. Run AFTER the
 * PR1 write-fix is deployed so no new string rows appear mid-backfill.
 *
 *   node scripts/backfill-jsonb-pr1.mjs            # dry-run: counts only
 *   node scripts/backfill-jsonb-pr1.mjs --apply    # execute the UPDATEs
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const APPLY = process.argv.includes('--apply');

let DATABASE_URL;
for (const raw of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('='); if (eq < 0) continue;
  const k = line.slice(0, eq).trim(); let v = line.slice(eq + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (k === 'DATABASE_URL') DATABASE_URL = v;
}
const sql = postgres(DATABASE_URL, { prepare: false });

// Object-valued jsonb columns: a clean un-double-encode. Guard on LIKE '{%' so a
// genuine (non-double-encoded) string scalar can never be mangled.
const OBJECT_COLS = [
  ['memory_events', 'payload'],
  ['monitors', 'config'],
  ['graph_nodes', 'attributes'],
];

async function typeofCounts(table, col) {
  const rows = await sql.unsafe(
    `SELECT jsonb_typeof(${col}) tt, count(*)::int c FROM ${table} GROUP BY 1 ORDER BY 1`);
  return rows.map((r) => `${r.tt}:${r.c}`).join(', ');
}

try {
  console.log(`\n=== JSONB PR1 backfill ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);

  for (const [table, col] of OBJECT_COLS) {
    console.log(`\n${table}.${col}`);
    console.log(`  before: ${await typeofCounts(table, col)}`);
    if (APPLY) {
      const res = await sql.unsafe(
        `UPDATE ${table} SET ${col} = (${col} #>> '{}')::jsonb
         WHERE jsonb_typeof(${col}) = 'string' AND (${col} #>> '{}') LIKE '{%'`);
      console.log(`  updated: ${res.count} rows`);
      console.log(`  after:  ${await typeofCounts(table, col)}`);
    }
  }

  // scores.dimensions — two steps: (A) un-double-encode, then (B) strip the
  // char-index keys that compounded from the read-modify-write bug.
  console.log(`\nscores.dimensions`);
  console.log(`  before: ${await typeofCounts('scores', 'dimensions')}`);
  if (APPLY) {
    const a = await sql.unsafe(
      `UPDATE scores SET dimensions = (dimensions #>> '{}')::jsonb
       WHERE jsonb_typeof(dimensions) = 'string' AND (dimensions #>> '{}') LIKE '{%'`);
    console.log(`  step A (un-double-encode): ${a.count} rows`);
    const b = await sql.unsafe(
      `UPDATE scores
          SET dimensions = COALESCE((
                SELECT jsonb_object_agg(k, v) FROM jsonb_each(dimensions)
                 WHERE k !~ '^[0-9]+$'
              ), '{}'::jsonb)
        WHERE jsonb_typeof(dimensions) = 'object'
          AND (SELECT bool_or(key ~ '^[0-9]+$') FROM jsonb_object_keys(dimensions) AS key)`);
    console.log(`  step B (strip char-index keys): ${b.count} rows`);
    console.log(`  after:  ${await typeofCounts('scores', 'dimensions')}`);
  }

  console.log('\nDone.' + (APPLY ? '' : ' (dry-run — re-run with --apply to execute)'));
} finally {
  await sql.end({ timeout: 5 });
}
