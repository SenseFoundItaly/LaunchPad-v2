/**
 * Stage 6 — Fundraise.
 * Runway is clear (or revenue is replacing it) and the capital plan is in
 * motion — a round open or revenue compounding.
 *
 * Re-bucketing note (2026-06 taxonomy unification): legacy "Growth"'s
 * runway_clear + capital_plan checks, unchanged ids and evaluator logic.
 * Growth's loop/metric checks moved to Stage 7 (Operate).
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { computeRunwayMonths } from '@/lib/finance/runway';

export const stageFundraise: Stage = {
  ...CANONICAL_BY_ID.fundraise,
  tagline: 'Runway clear, capital plan in motion.',
  checks: [
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
          ? { passed: true, evidence: `You have ${months.toFixed(1)} months of runway.` }
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
          ? { passed: true, evidence: hasRound ? 'Your raise is open and in motion.' : "You're generating revenue." }
          : { passed: false, gap: 'Open a round or wire revenue metric' };
      },
    },
  ],
};
