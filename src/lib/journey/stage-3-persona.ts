/**
 * Stage 3 — Persona.
 * Beachhead chosen. ICP defined. Acquisition path imagined. The founder
 * can point at a specific list of N people and say "these are the ones."
 *
 * Re-bucketing note (2026-06 taxonomy unification): all of legacy
 * "Segment"'s checks, unchanged ids and evaluator logic.
 * 2026-07 (L2 Phase-0 alignment): the `target_market` presence check moved to
 * Stage 1 as `target_icp_defined` — the spec puts the PRELIMINARY target/ICP
 * in the Idea Canvas ("aggiornato post-Loop 1"). Stage 3 keeps the deeper
 * fact-based ICP/channels validation.
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';
import { countMemoryFactsMatching } from './snapshot';

export const stagePersona: Stage = {
  ...CANONICAL_BY_ID.persona,
  tagline: 'Beachhead picked, ICP described, acquisition path imagined.',
  checks: [
    {
      id: 'icp_defined',
      label: 'ICP described',
      source: 'memory_facts (ICP)',
      evaluate: (s) => {
        // Bilingual EN+IT (keyword-gate discipline, same as the Stage-2 lists) —
        // these were EN-only, so an Italian founder stating their ICP could
        // never green the check (i18n gap audit 21/07). 'persona' matches both.
        const n = countMemoryFactsMatching(s, [
          'ICP', 'ideal customer', 'persona', 'beachhead',
          'cliente ideale', 'profilo del cliente', 'cliente tipo',
        ]);
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
        // Bilingual EN+IT — see icp_defined above.
        const n = countMemoryFactsMatching(s, [
          'channel', 'acquisition', 'reach customers', 'outreach', 'distribution',
          'canale', 'canali', 'acquisizione', 'distribuzione',
        ]);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: "You've identified how you'll reach customers." }
          : { passed: false, gap: 'Identify at least one acquisition channel' };
      },
    },
    // NOTE: a former 4th check `segment_signals` gated this stage on ≥10
    // watcher-attributed competitor signals ("X of 10 — let monitors run
    // longer"). Removed 2026-06-12: that measured monitoring THROUGHPUT, not
    // founder validation — a passive, agent-gated dead-end with no founder
    // action, which could also stall the stage forever when no watchers were
    // set up. Persona/Segment now validates purely on founder-driven evidence
    // (target market · ICP · channels).
  ],
};
