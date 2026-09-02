#!/usr/bin/env -S npx tsx
/**
 * Run: npx tsx scripts/grants-sync-dryrun.mjs   (tsx — the connectors are TypeScript)
 * Grants tracking — LIVE connector dry run. Reads the two sources, writes NOTHING.
 *
 * What it does: runs the real SEDIA (EU Funding & Tenders search API) and
 * Regione Lombardia (Socrata + detail pages) connectors exactly as the cron
 * sync would, then prints per-source counts, a few normalized samples and a
 * set of OK/FAIL invariants on the parsed deadlines.
 *
 * What it never does: touch the database. It imports ONLY the connectors and
 * the pure date helpers (relative paths — '@/lib/db' is unreachable from any
 * of them by design), so it is safe against prod `.env.local` and usable
 * BEFORE migration 044 is applied. Every DB write in grants tracking lives in
 * src/lib/grants/sync.ts, which this script does not import.
 *
 * The connectors are TypeScript, so run it with tsx (already the repo's
 * runner for db/migrate.ts):
 *
 *   npx tsx scripts/grants-sync-dryrun.mjs
 *
 * Knobs (env): GRANTS_MAX_PAGES  — SEDIA search pages of 100 (default 8)
 *              GRANTS_MAX_DETAIL — Lombardia detail pages fetched (default 3)
 *
 * Exit code 1 when either connector throws or any invariant FAILs; 0 otherwise.
 */
import { fetchSediaCalls } from '../src/lib/grants/sources/sedia.ts';
import { fetchLombardiaCalls } from '../src/lib/grants/sources/lombardia.ts';
import { toDateOnly } from '../src/lib/grants/dates.ts';

const TAG = '[grants-dryrun]';
const now = new Date();
const today = toDateOnly(now);
let exitCode = 0;

const maxPages = Number(process.env.GRANTS_MAX_PAGES ?? 8);
const maxDetail = Number(process.env.GRANTS_MAX_DETAIL ?? 3);

console.log(`${TAG} now=${now.toISOString()} today=${today} maxPages=${maxPages} maxDetail=${maxDetail}`);
console.log(`${TAG} live connectors, NO DB writes (sync.ts is not imported)`);

/** Run one connector, timed, never throwing out of here. */
async function runSource(source, fn) {
  const started = Date.now();
  try {
    const calls = await fn();
    return { source, calls, ms: Date.now() - started, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${TAG} ${source} FAILED: ${message}`);
    exitCode = 1;
    return { source, calls: [], ms: Date.now() - started, error: message };
  }
}

function countBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const k = String(keyFn(item));
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function sample(call) {
  return {
    source_identifier: call.source_identifier,
    title: call.title.length > 80 ? `${call.title.slice(0, 80)}…` : call.title,
    granting_body: call.granting_body,
    deadline: call.deadline,
    deadline_time: call.deadline_time,
    status: call.status,
    parse_method: call.parse_method,
    raw_snippet: call.raw_snippet,
    official_url: call.official_url,
    eligibility_text: call.eligibility_text ? call.eligibility_text.slice(0, 120) : null,
  };
}

function summarize({ source, calls, ms, error }) {
  const deadlines = calls.map((c) => c.deadline).filter((d) => d !== null).sort();
  const summary = {
    source,
    count: calls.length,
    ms,
    error,
    open: calls.filter((c) => c.status === 'open').length,
    rolling: calls.filter((c) => c.status === 'rolling').length,
    min_deadline: deadlines[0] ?? null,
    max_deadline: deadlines[deadlines.length - 1] ?? null,
    with_eligibility_text: calls.filter((c) => Boolean(c.eligibility_text)).length,
    by_parse_method: countBy(calls, (c) => c.parse_method),
  };
  console.log(`\n${TAG} ${source} summary`);
  console.log(JSON.stringify(summary, null, 2));

  if (calls.length === 0) return;
  const picks = [];
  const firstOpen = calls.find((c) => c.status === 'open');
  const firstRolling = calls.find((c) => c.status === 'rolling');
  const last = calls[calls.length - 1];
  for (const c of [firstOpen, firstRolling, last]) {
    if (c && !picks.includes(c)) picks.push(c);
  }
  console.log(`${TAG} ${source} samples (first open, first rolling if any, last)`);
  for (const c of picks) console.log(JSON.stringify(sample(c), null, 2));
}

/** One OK/FAIL line per invariant; any FAIL flips the exit code. */
function check(label, ok, detail) {
  if (ok) {
    console.log(`OK   ${label}`);
  } else {
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`);
    exitCode = 1;
  }
}

function assertInvariants({ source, calls, error }, minCount) {
  console.log(`\n${TAG} ${source} invariants`);
  if (error) {
    check(`${source}: connector completed`, false, error);
    return;
  }
  const nullDeadlineNotRolling = calls.filter((c) => c.deadline === null && c.status !== 'rolling');
  check(
    `${source}: deadline is null only when status === 'rolling'`,
    nullDeadlineNotRolling.length === 0,
    nullDeadlineNotRolling.map((c) => c.source_identifier).slice(0, 5).join(', '),
  );
  const pastDeadlines = calls.filter((c) => c.deadline !== null && c.deadline < today);
  check(
    `${source}: every non-null deadline >= ${today}`,
    pastDeadlines.length === 0,
    pastDeadlines.map((c) => `${c.source_identifier}=${c.deadline}`).slice(0, 5).join(', '),
  );
  const badUrls = calls.filter((c) => !/^https:\/\//.test(c.official_url));
  check(
    `${source}: every official_url starts with https://`,
    badUrls.length === 0,
    badUrls.map((c) => c.official_url).slice(0, 5).join(', '),
  );
  const openNoSnippet = calls.filter((c) => c.status === 'open' && !c.raw_snippet);
  check(
    `${source}: raw_snippet non-empty for every 'open' call`,
    openNoSnippet.length === 0,
    openNoSnippet.map((c) => c.source_identifier).slice(0, 5).join(', '),
  );
  check(`${source}: count ${calls.length} > ${minCount}`, calls.length > minCount);
}

// Sequential on purpose: two live sources, readable timings.
const sedia = await runSource('sedia', () => fetchSediaCalls({ now, maxPages }));
const lombardia = await runSource('lombardia', () => fetchLombardiaCalls({ now, maxDetailFetches: maxDetail }));

summarize(sedia);
summarize(lombardia);
assertInvariants(sedia, 100);
assertInvariants(lombardia, 50);

console.log(`\n${TAG} no DB writes performed`);
console.log(`${TAG} exit ${exitCode}`);
process.exit(exitCode);
