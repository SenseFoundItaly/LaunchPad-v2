/**
 * Stage 7 — Operate.
 * Loops running. Metrics tracked. The founder is no longer guessing —
 * they're optimizing a repeatable engine.
 *
 * Re-bucketing note (2026-06 taxonomy unification): legacy "Growth"'s
 * loop_active + metrics_tracked checks, unchanged ids and evaluator logic.
 * Growth's runway/capital checks moved to Stage 6 (Fundraise).
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';

export const stageOperate: Stage = {
  ...CANONICAL_BY_ID.operate,
  tagline: 'Loops compounding, metrics moving.',
  checks: [
    {
      id: 'loop_active',
      label: '1+ growth loop active',
      source: 'growth_loops',
      evaluate: (s) => {
        const active = s.growth_loops.filter((l) => l.status === 'active').length;
        const ok = active >= 1;
        return ok
          ? { passed: true, evidence: `${active} active loop${active === 1 ? '' : 's'}` }
          : { passed: false, gap: 'Design a growth loop with Co-pilot' };
      },
    },
    {
      id: 'metrics_tracked',
      label: '3+ metrics tracked',
      source: 'metrics',
      evaluate: (s) => {
        const n = s.metrics.length;
        const ok = n >= 3;
        return ok
          ? { passed: true, evidence: `${n} metrics tracked` }
          : { passed: false, gap: `${n} of 3 — wire activation, retention, revenue` };
      },
    },
  ],
};
