#!/usr/bin/env node
/**
 * WHICH part of the chat prompt is busting the cache?
 *
 * Background (prod, 30d, measured 2026-08-10):
 *   chat = $74.55 of ~$84 total spend; cache WRITES 14.73M tok ≈ $55 ≈ 74% of
 *   chat cost. 84% of those writes land on turns arriving within 5 minutes of
 *   the previous one — while the 5-min cache is still LIVE. So the prefix is
 *   being MUTATED, not expiring, and raising the TTL cannot help. (On this
 *   stack it cannot even be raised: pi-ai only emits ttl:"1h" when the baseUrl
 *   is api.anthropic.com, and prod is 100% OpenRouter.)
 *
 * A first pass with one whole-prompt hash proved the system prompt changes on
 * 100% of turns — but not WHICH ~300 of its ~88,000 chars moved, and you cannot
 * fix what you have not localised. This reads the per-section hashes written by
 * chat/route.ts and reports, per section: how often it moved and how big it is.
 *
 * It also tests the competing explanation. Anthropic walks back at most 20
 * content blocks from a breakpoint; a turn appending more than that misses the
 * cache even when every byte of the prefix is identical. If that is what is
 * happening, no amount of prompt surgery will fix it.
 *
 * Read-only.
 *   node scripts/cache-fingerprint-report.mjs [--days 7] [--project proj_x]
 */
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

const ENV_CANDIDATES = [
  path.resolve(process.cwd(), '.env.local'),
  path.resolve(process.cwd(), '.env'),
  '/Users/mikececconello/code/mikececco/tech-bricks/LaunchPad-v2/.env.local',
];
for (const file of ENV_CANDIDATES) {
  if (!fs.existsSync(file)) continue;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const eq = l.indexOf('=');
    if (eq < 0) continue;
    const k = l.slice(0, eq).trim();
    const v = l.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
  break;
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not found'); process.exit(1); }

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const DAYS = Number(arg('--days', '7'));
const PROJECT = arg('--project', null);

const WRITE_RATE = 3.75;            // Sonnet 4.6 $/M, src/lib/llm/models.ts
const usd = (tok) => (tok * WRITE_RATE) / 1e6;
const pct = (n, d) => (d ? ((100 * n) / d).toFixed(0) : '0') + '%';

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require', max: 2 });

// Legacy rows are double-encoded (a jsonb STRING holding JSON), so normalise.
const asObj = (v) => {
  if (!v) return null;
  if (typeof v === 'object') return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  return null;
};

const rows = await sql`
  SELECT project_id, "timestamp", meta
    FROM chat_messages
   WHERE role = 'assistant' AND meta IS NOT NULL
     AND "timestamp" > now() - (${DAYS} || ' days')::interval
     ${PROJECT ? sql`AND project_id = ${PROJECT}` : sql``}
   ORDER BY project_id, "timestamp" ASC`;

const turns = rows
  .map((r) => ({ project: r.project_id, ...(asObj(r.meta)?.cacheFp ?? {}) }))
  .filter((t) => t.sections);

if (turns.length === 0) {
  console.error(
    `No per-section cacheFp rows in the last ${DAYS}d.\n` +
    `Run: node scripts/cache-probe.mjs --project <warm project id>`,
  );
  await sql.end();
  process.exit(1);
}

// ─── per-section churn ───────────────────────────────────────────────────────
const names = [...new Set(turns.flatMap((t) => Object.keys(t.sections)))];
const churn = Object.fromEntries(names.map((n) => [n, { moved: 0, bytes: 0, present: 0 }]));
let compared = 0;
let prev = null;

for (const t of turns) {
  for (const n of names) {
    const cur = t.sections[n];
    if (!cur) continue;
    churn[n].present += 1;
    churn[n].bytes = Math.max(churn[n].bytes, cur[1]);
  }
  if (prev && prev.project === t.project) {
    compared += 1;
    for (const n of names) {
      const a = prev.sections[n];
      const b = t.sections[n];
      if (a && b && a[0] !== b[0]) churn[n].moved += 1;
    }
  }
  prev = t;
}

const totalWrites = turns.reduce((a, t) => a + (t.writes || 0), 0);
const totalReads = turns.reduce((a, t) => a + (t.reads || 0), 0);

console.log(`\nPrompt-section churn — last ${DAYS}d${PROJECT ? ` · ${PROJECT}` : ''}`);
console.log(`${turns.length} turns · ${compared} comparable · writes ${(totalWrites / 1e6).toFixed(2)}M ($${usd(totalWrites).toFixed(2)}) · reads ${(totalReads / 1e6).toFixed(2)}M\n`);

console.table(
  names
    .map((n) => ({
      section: n,
      moved_on: `${churn[n].moved}/${compared}`,
      rate: pct(churn[n].moved, compared),
      max_chars: churn[n].bytes,
      // A section that never moves is already cacheable; one that moves on
      // every turn and is large is the whole problem.
      verdict: churn[n].moved === 0 ? 'stable'
        : churn[n].moved >= compared ? 'MOVES EVERY TURN'
          : 'intermittent',
    }))
    .sort((a, b) => (b.moved_on.split('/')[0] - a.moved_on.split('/')[0]) || (b.max_chars - a.max_chars)),
);

// ─── the competing explanation: 20-block lookback ────────────────────────────
const withBlocks = turns.filter((t) => typeof t.appendedBlocks === 'number');
if (withBlocks.length) {
  const over = withBlocks.filter((t) => t.appendedBlocks > 20);
  const zeroRead = withBlocks.filter((t) => (t.reads || 0) === 0);
  const zeroReadOver = zeroRead.filter((t) => t.appendedBlocks > 20);
  console.log('\n20-block lookback window');
  console.log(`  turns appending >20 blocks: ${over.length}/${withBlocks.length} (${pct(over.length, withBlocks.length)})`);
  console.log(`  turns with ZERO cache reads: ${zeroRead.length}/${withBlocks.length} (${pct(zeroRead.length, withBlocks.length)})`);
  console.log(`  ...of those, over the window: ${zeroReadOver.length}/${zeroRead.length || 1}`);
  console.log(`  max appended blocks seen: ${Math.max(...withBlocks.map((t) => t.appendedBlocks))} (tool calls drive this)`);
  if (zeroRead.length && zeroReadOver.length === 0) {
    console.log('  → misses are NOT the block window. Prompt bytes are the cause; fix the sections above.');
  } else if (zeroReadOver.length === zeroRead.length && zeroRead.length > 0) {
    console.log('  → every miss is over the window. Prompt surgery will NOT help; reduce blocks per turn.');
  } else if (zeroRead.length) {
    console.log('  → mixed. Both causes are live; fix the sections first, they are cheaper.');
  }
}

// ─── what is actually cacheable ──────────────────────────────────────────────
const stat = churn.STATIC;
if (stat) {
  console.log('\nStatic prefix (SOUL + AGENTS + ARTIFACT_INSTRUCTIONS + JOURNEY_RULES)');
  console.log(`  ${stat.bytes.toLocaleString()} chars ≈ ${Math.round(stat.bytes / 4).toLocaleString()} tokens · moved on ${stat.moved}/${compared} turns`);
  console.log(stat.moved === 0
    ? '  → stable, so it is pure upside: every turn it is re-written is a turn it did not have to be.'
    : '  → NOT stable. Fix this before anything else; the whole premise assumes it is.');
}

console.log('\nFix the largest section with the highest move rate first.\n');
await sql.end();
