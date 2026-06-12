/**
 * Stage 3 — Persona.
 * Beachhead chosen. ICP defined. Acquisition path imagined. The founder
 * can point at a specific list of N people and say "these are the ones."
 *
 * Re-bucketing note (2026-06 taxonomy unification): all of legacy
 * "Segment"'s checks, unchanged ids and evaluator logic.
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { countMemoryFactsMatching } from './snapshot';

export const stagePersona: Stage = {
  ...CANONICAL_BY_ID.persona,
  tagline: 'Beachhead picked, ICP described, acquisition path imagined.',
  checks: [
    {
      id: 'target_market',
      label: 'Target market named',
      source: 'idea_canvas.target_market',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.target_market?.trim();
        return ok
          ? { passed: true, evidence: "You've named your target market." }
          : { passed: false, gap: 'Name the target market' };
      },
    },
    {
      id: 'icp_defined',
      label: 'ICP described',
      source: 'memory_facts (ICP)',
      evaluate: (s) => {
        const n = countMemoryFactsMatching(s, ['ICP', 'ideal customer', 'persona', 'beachhead']);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: "You've described your ideal customer." }
          : { passed: false, gap: 'Describe the ideal customer profile' };
      },
    },
    {
      id: 'channels_identified',
      label: 'Acquisition channels identified',
      source: 'memory_facts (channels)',
      evaluate: (s) => {
        const n = countMemoryFactsMatching(s, ['channel', 'acquisition', 'reach customers', 'outreach', 'distribution']);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: "You've identified how you'll reach customers." }
          : { passed: false, gap: 'Identify at least one acquisition channel' };
      },
    },
    {
      id: 'segment_signals',
      label: 'Segment validated by signals',
      source: 'competitor_profiles + monitors',
      evaluate: (s) => {
        const totalSignals = s.competitors.reduce((sum, c) => sum + (c.total_signals ?? 0), 0);
        const ok = totalSignals >= 10;
        return ok
          ? { passed: true, evidence: `Your segment is backed by ${totalSignals} market signals.` }
          : { passed: false, gap: `${totalSignals} of 10 — let monitors run longer` };
      },
    },
  ],
};
