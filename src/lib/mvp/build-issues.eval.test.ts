// ============================================================================
// EVAL — feedback-intake classifier (not a unit test).
//
// Scores the LLM match-or-spawn decision against a golden set. Gated OFF by
// default: it makes ~28 real (cheap-tier) model calls, and LLM scores are noisy
// enough that wiring them into CI would flake the build. Run deliberately:
//
//     npm run eval:classifier          (= EVAL_CLASSIFIER=1 vitest run …)
//
// Run it before changing the classifier prompt, its model tier, or the intake
// flow — those are the changes that silently degrade the backlog.
//
// Floors are set BELOW observed performance, so they catch regressions rather
// than normal run-to-run variance. Failures print a per-case table.
// ============================================================================

import { describe, it, expect } from 'vitest';
import { classifyFeedback } from './build-issues';
import { GOLDEN_CASES, FALSE_MERGE_MODES, type GoldenCase } from './build-issues.golden';

const ENABLED = process.env.EVAL_CLASSIFIER === '1';

// Floors. Over-merging is the dangerous direction (a wrong merge is invisible
// to the founder and corrupts the evidence counter that gates spend), so the
// false-merge ceiling is tighter than the overall accuracy floor.
const MIN_OVERALL_ACCURACY = 0.8;
const MAX_FALSE_MERGE_RATE = 0.15;
const MIN_MERGE_RECALL = 0.7;

interface Scored {
  case: GoldenCase;
  got: 'match' | 'spawn';
  gotId?: string;
  correct: boolean;
  falseMerge: boolean;
}

async function scoreOne(c: GoldenCase): Promise<Scored> {
  let got: 'match' | 'spawn' = 'spawn';
  let gotId: string | undefined;
  try {
    const v = await classifyFeedback(c.body, c.open); // no projectId → unmetered
    if (v.matchId && c.open.some((i) => i.id === v.matchId)) {
      got = 'match';
      gotId = v.matchId;
    }
  } catch {
    // A thrown classifier is fail-open in production (evidence stays loose),
    // which is behaviourally a "spawn" — score it as such rather than crashing.
  }
  const correct = c.expect.type === 'match' ? got === 'match' && gotId === c.expect.id : got === 'spawn';
  return { case: c, got, gotId, correct, falseMerge: c.expect.type === 'spawn' && got === 'match' };
}

describe.skipIf(!ENABLED)('EVAL — feedback intake classifier', () => {
  it(
    'meets the accuracy floors on the golden set',
    async () => {
      const results: Scored[] = [];
      // Sequential: the cheap tier is rate-limit sensitive and this is a
      // deliberate offline run, not a latency-critical path.
      for (const c of GOLDEN_CASES) results.push(await scoreOne(c));

      const total = results.length;
      const correct = results.filter((r) => r.correct).length;
      const accuracy = correct / total;

      const falseMergeCases = results.filter((r) => FALSE_MERGE_MODES.has(r.case.mode));
      const falseMerges = falseMergeCases.filter((r) => r.falseMerge).length;
      const falseMergeRate = falseMergeCases.length ? falseMerges / falseMergeCases.length : 0;

      const shouldMerge = results.filter((r) => r.case.expect.type === 'match');
      const mergeRecall = shouldMerge.length
        ? shouldMerge.filter((r) => r.correct).length / shouldMerge.length
        : 1;

      // Per-mode breakdown — a regression should point at a behaviour.
      const byMode = new Map<string, { n: number; ok: number }>();
      for (const r of results) {
        const m = byMode.get(r.case.mode) ?? { n: 0, ok: 0 };
        m.n++;
        if (r.correct) m.ok++;
        byMode.set(r.case.mode, m);
      }

      console.log('\n── classifier eval ─────────────────────────────');
      console.log(`overall accuracy   ${(accuracy * 100).toFixed(1)}%  (${correct}/${total})`);
      console.log(`merge recall       ${(mergeRecall * 100).toFixed(1)}%  (should-merge caught)`);
      console.log(`FALSE-MERGE rate   ${(falseMergeRate * 100).toFixed(1)}%  (${falseMerges}/${falseMergeCases.length})  ← the dangerous one`);
      for (const [mode, m] of byMode) {
        console.log(`  ${mode.padEnd(30)} ${m.ok}/${m.n}`);
      }
      const misses = results.filter((r) => !r.correct);
      if (misses.length) {
        console.log('\nmisses:');
        for (const m of misses) {
          const want = m.case.expect.type === 'match' ? `match ${m.case.expect.id}` : 'spawn';
          console.log(`  ✗ [${m.case.mode}] ${m.case.name}\n      want ${want}, got ${m.got}${m.gotId ? ' ' + m.gotId : ''}`);
        }
      }
      console.log('────────────────────────────────────────────────\n');

      expect(falseMergeRate).toBeLessThanOrEqual(MAX_FALSE_MERGE_RATE);
      expect(accuracy).toBeGreaterThanOrEqual(MIN_OVERALL_ACCURACY);
      expect(mergeRecall).toBeGreaterThanOrEqual(MIN_MERGE_RECALL);
    },
    15 * 60_000,
  );
});
