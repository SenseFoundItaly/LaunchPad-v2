/**
 * Backfill: un-double-encode the JSONB columns fixed in PR2 (array/sources sweep).
 *
 * A `JSON.stringify(x)` bound to a jsonb column stored a JSON *string* scalar.
 * This re-parses those legacy rows back to objects/arrays. Idempotent (guarded on
 * jsonb_typeof='string' AND the inner text starts with { or [ so a genuine string
 * scalar can never be mangled). Run AFTER the PR2 write-fix is deployed.
 *
 *   node scripts/backfill-jsonb-pr2.mjs            # dry-run: counts
 *   node scripts/backfill-jsonb-pr2.mjs --apply    # execute
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

// (table, column) pairs that had string (double-encoded) rows in the gap audit.
const COLS = [
  ['graph_nodes', 'sources'],
  ['graph_edges', 'sources'],
  ['signal_activity_logs', 'metadata'],
  ['memory_facts', 'sources'],
  ['interviews', 'meta'],
  ['interviews', 'sources'],
  ['competitor_profiles', 'signal_counts'],
  ['research', 'sources'],
  ['research', 'competitors'],
  ['research', 'trends'],
  ['research', 'market_size'],
  ['research', 'key_insights'],
  ['monitors', 'urls_to_track'],
  ['monitors', 'sources'],
  ['scores', 'sources'],
  ['tabular_cells', 'values'],
  ['tabular_reviews', 'columns'],
  ['tabular_reviews', 'column_types'],
  ['tabular_reviews', 'sources'],
  ['chat_messages', 'citations'],
  ['watch_sources', 'scrape_config'],
  ['intelligence_briefs', 'signal_ids'],
  ['intelligence_briefs', 'recommended_actions'],
  ['pricing_state', 'tiers'],
  ['pricing_state', 'wtp'],
  ['pricing_state', 'unit_econ'],
  // legacy strings on already-correct writers — safe to clean (readers tolerate both):
  ['pending_actions', 'payload'],
  ['pending_actions', 'execution_result'],
  ['pending_actions', 'edited_payload'],
];

async function strCount(t, c) {
  const r = await sql.unsafe(`SELECT count(*)::int n FROM ${t} WHERE jsonb_typeof(${c}) = 'string'`);
  return r[0].n;
}

try {
  console.log(`\n=== JSONB PR2 backfill ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===`);
  let totalBefore = 0, totalUpdated = 0;
  for (const [t, c] of COLS) {
    const before = await strCount(t, c);
    totalBefore += before;
    if (before === 0) continue;
    if (APPLY) {
      // first char of the inner text must be { or [ — guards against mangling a
      // genuine (non-double-encoded) string scalar into invalid jsonb.
      const res = await sql.unsafe(
        `UPDATE ${t} SET ${c} = (${c} #>> '{}')::jsonb
         WHERE jsonb_typeof(${c}) = 'string' AND left(${c} #>> '{}', 1) IN ('{', '[')`);
      const after = await strCount(t, c);
      totalUpdated += res.count;
      console.log(`  ${`${t}.${c}`.padEnd(40)} ${String(before).padStart(4)} → updated ${String(res.count).padStart(4)} → ${after} string left`);
    } else {
      console.log(`  ${`${t}.${c}`.padEnd(40)} string: ${before}`);
    }
  }
  console.log(`\n  total string rows ${APPLY ? `before: ${totalBefore} · updated: ${totalUpdated}` : `to fix: ${totalBefore}`}`);
} finally {
  await sql.end({ timeout: 5 });
}
