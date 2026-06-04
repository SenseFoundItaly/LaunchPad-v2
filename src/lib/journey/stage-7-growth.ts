/**
 * Stage 7 — Growth.
 * Loops running. Metrics tracked. Runway clear (or revenue replacing it).
 * The founder is no longer guessing — they're optimizing.
 */

import type { Stage } from './types';
import { computeRunwayMonths } from '@/lib/finance/runway';

export const stageGrowth: Stage = {
  id: 'growth',
  number: 7,
  label: 'Growth',
  tagline: 'Loops compounding, metrics moving, runway clear.',
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
    {
      id: 'runway_clear',
      label: 'Runway ≥ 12 months',
      source: 'burn_rate',
      evaluate: (s) => {
        const months = computeRunwayMonths(s.burn_rate?.cash_on_hand, s.burn_rate?.monthly_burn);
        if (months == null) {
          return { passed: false, gap: 'Set burn rate + cash on hand in Finance' };
        }
        const ok = months >= 12;
        return ok
          ? { passed: true, evidence: `${months.toFixed(1)} months runway` }
          : { passed: false, gap: `${months.toFixed(1)}mo — raise or cut burn` };
      },
    },
    {
      id: 'capital_plan',
      label: 'Capital plan in motion',
      source: 'fundraising_rounds OR revenue metric',
      evaluate: (s) => {
        const round = s.fundraising_round;
        const hasRound = !!round && round.status === 'open';
        const hasRevenue = s.metrics.some((m) =>
          /revenue|mrr|arr/i.test(m.name) && (m.current_value ?? 0) > 0,
        );
        const ok = hasRound || hasRevenue;
        return ok
          ? { passed: true, evidence: hasRound ? `Round open: ${round?.status}` : 'Revenue tracked' }
          : { passed: false, gap: 'Open a round or wire revenue metric' };
      },
    },
  ],
};
