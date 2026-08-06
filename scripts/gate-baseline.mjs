#!/usr/bin/env node
/**
 * Consolidated Validation Gate baseline — N walkthroughs, one verdict.
 *
 * A single walkthrough is NOT a measurement. Two consecutive runs of identical
 * code scored 9/21 and 7/21: the co-pilot batches different evidence on
 * different turns, so one turn may green three checks and the next none. Acting
 * on a single run means chasing noise — and it already produced one overstated
 * result in this project's history (a "3 -> 9" that was partly luck).
 *
 * So this runs N fresh founders in parallel and reports each check by how OFTEN
 * it closes, not whether it closed once:
 *
 *   ALWAYS   green in every run  — really works
 *   FLAKY    green in some       — works when the model happens to batch it,
 *                                  which for a founder means "sometimes"
 *   NEVER    green in none       — really broken
 *
 * FLAKY is the category that matters. A check that greens half the time is not
 * half-working; it is a founder who did the work and watched nothing happen.
 *
 * Run: E2E_AUTH_ENABLED=1 dev server on :3005, then
 *      node scripts/gate-baseline.mjs [runs]      (default 3)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const RUNS = Number(process.argv[2] ?? 3);
const here = path.dirname(new URL(import.meta.url).pathname);
const WALK = path.join(here, 'sim-gate-walkthrough.mjs');

const stamp = Math.random().toString(36).slice(2, 8);
const outFiles = Array.from({ length: RUNS }, (_, i) => `/tmp/gate-baseline-${stamp}-${i}.json`);

console.log(`gate baseline — ${RUNS} walkthrough(s) in parallel\n`);

await Promise.all(outFiles.map((out, i) => new Promise((resolve) => {
  const p = spawn('node', [WALK], {
    env: { ...process.env, GATE_WALK_OUT: out },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // Surface only the per-turn lines, tagged, so N interleaved runs stay readable.
  p.stdout.on('data', (b) => {
    for (const line of String(b).split('\n')) if (line.trim()) console.log(`  [run ${i + 1}] ${line.trim()}`);
  });
  p.stderr.on('data', (b) => console.error(`  [run ${i + 1}] ERR ${String(b).slice(0, 200)}`));
  p.on('close', (code) => { console.log(`  [run ${i + 1}] exit ${code}`); resolve(); });
})));

const runs = outFiles.map((f) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}).filter((r) => r?.gate?.final);

if (runs.length === 0) { console.error('\nNo run produced a final gate — nothing to consolidate.'); process.exit(1); }
if (runs.length < RUNS) console.log(`\n⚠ only ${runs.length}/${RUNS} runs finished; the tally below is over those.`);

// Tally per check. `locked` is reported separately from `failed`: a locked 1C
// check is not a broken check, it is an unreached one, and conflating them
// would make 1C look like ten failures.
const checks = runs[0].gate.final.map((c) => c.id);
const rows = checks.map((id) => {
  const states = runs.map((r) => r.gate.final.find((c) => c.id === id));
  return {
    id,
    track: states[0]?.track ?? '',
    green: states.filter((c) => c?.passed).length,
    locked: states.filter((c) => c?.locked).length,
  };
});

const verdict = (r) => (r.locked === runs.length ? 'LOCKED'
  : r.green === runs.length ? 'ALWAYS'
  : r.green === 0 ? 'NEVER' : 'FLAKY');

console.log(`\n${'='.repeat(58)}\nCONSOLIDATO su ${runs.length} run\n${'='.repeat(58)}`);
for (const r of rows) {
  const v = verdict(r);
  const mark = { ALWAYS: '✅', FLAKY: '🟡', NEVER: '❌', LOCKED: '🔒' }[v];
  console.log(`  ${mark} ${v.padEnd(7)} ${r.track.padEnd(3)} ${r.id.padEnd(26)} ${r.green}/${runs.length}`);
}
const tot = runs.map((r) => r.gate.final.filter((c) => c.passed).length);
console.log(`\n  totali per run: ${tot.join(' · ')}  (min ${Math.min(...tot)}, max ${Math.max(...tot)}) su ${checks.length}`);
console.log(`  ALWAYS ${rows.filter((r) => verdict(r) === 'ALWAYS').length} · FLAKY ${rows.filter((r) => verdict(r) === 'FLAKY').length} · NEVER ${rows.filter((r) => verdict(r) === 'NEVER').length} · LOCKED ${rows.filter((r) => verdict(r) === 'LOCKED').length}`);
console.log(`\n  run files: ${outFiles.join(' ')}`);
