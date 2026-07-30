/**
 * IRL — Investment Readiness Level, as a 1-9 evidence-gated developmental ladder.
 *
 * Replaces the old `done / 7 stages` readout. IRL is the "how investable are
 * you" axis — distinct from Score (idea quality, volatile) and from workflow
 * progression (founder-controlled, never blocks). Each point is EARNED against
 * a deterministic, SF-set evidence bar — the AI measures against the bar, it
 * does not decide advancement.
 *
 * Design (agreed with founder, 2026-07-23 — epic #293):
 *  - The gate reads EVIDENCE directly (WTP ≥ 30%, LTV/CAC ≥ 3×, …), NOT "did a
 *    loop run". So dismissing a loop (override) lets you proceed but earns NO
 *    point — the evidence still hasn't passed — and the ladder works before
 *    Loops 2-4 are even live.
 *  - IRL = the highest CONTIGUOUS level whose gate holds, recomputed from state
 *    every call (never a stored high-water-mark). A heavy pivot that invalidates
 *    an earned level's evidence naturally drops the index.
 *  - Levels 7-9 unlock only via paid add-on modules (GTM orchestration /
 *    Fundraising readiness / Operations) — not built yet, so their gates can't
 *    pass and the ladder naturally caps where the built evidence ends. As the
 *    metric feeds (Loops 3-4) and add-ons ship, higher levels light up with no
 *    change here.
 *
 * Zero runtime deps on purpose (no DB / journey imports): the route precomputes
 * a flat `IrlEvidence` and calls `computeIRL`, so this stays pure + testable.
 */

import type { StageId } from '@/lib/journey/types';

export const IRL_MAX = 9;
/** The last SEQUENTIAL level. 1-6 are the phase ladder (contiguous); 7-9 are
 *  the independent paid add-on modules. */
export const IRL_CORE_MAX = 6;

// Evidence bars — policy, SF-set, mirrored from the loop thresholds. Central so
// the ladder and the loops can never disagree on what "passing" means.
export const IRL_WTP_BAR = 0.30;        // Loop 1 (PSF)
export const IRL_LTV_CAC_BAR = 3;       // Loop 2 (BM stress test)
export const IRL_CONVERSION_BAR = 0.05; // Loop 3 (market response)
export const IRL_ACTIVATION_BAR = 0.20; // Loop 4 (MVP test verdict)
/**
 * Level 2 needs a real first scoring — the founder spec says
 * "First scoring (Caution/Go)", i.e. the score must clear the CAUTION band, not
 * merely exist. 40 is the caution floor in score-display.ts's band(); below that
 * is "weak" and must not earn a rung ("ogni punto deve essere sudato").
 */
export const IRL_SCORE_BAR = 40;

/**
 * Everything a ladder gate reads — precomputed by the route from the snapshot,
 * stage evaluations, score, and the loop-evidence functions. Flat + pure so the
 * ladder has no DB/journey coupling.
 */
export interface IrlEvidence {
  /** A canonical stage's evaluation is `done` (all its checks passed). */
  stageDone: (id: StageId) => boolean;
  /** All Validation-Gate checks tagged with this track passed (≥1 exists). */
  trackDone: (track: '1A' | '1B' | '1C') => boolean;
  /** The project's 0-100 score, or null when never scored. Level 2 requires it
   *  to clear IRL_SCORE_BAR (the "Caution/Go" bar), not merely to exist. */
  score: number | null;
  /** Loop-1 bar: willingness-to-pay rate; null until measurable (< min interviews). */
  wtpRate: number | null;
  /** Loop-2 bar: LTV/CAC ratio; null when unit economics are absent. */
  ltvCacRatio: number | null;
  /** Loop-3 bar: landing conversion; null until the Launch Pipeline metric feed exists. */
  conversionRate: number | null;
  /** Loop-4 bar: MVP activation; null until the Build Hub metric feed exists. */
  activationRate: number | null;
  /** Completed paid add-on modules (IRL 7-9), by key. Empty until built. */
  addOns: ReadonlySet<string>;
}

export interface IrlLevel {
  level: number;
  key: string;
  /** i18n key suffix under `irl.level-*` for the short label. */
  labelKey: string;
  /** Deterministic evidence gate. */
  gate: (e: IrlEvidence) => boolean;
}

/**
 * Levels 1-6 — the SEQUENTIAL phase ladder. Contiguous: you cannot be
 * investment-ready at 4 with a broken level-2 signal underneath.
 */
export const IRL_CORE_LADDER: readonly IrlLevel[] = [
  { level: 1, key: 'idea_canvas', labelKey: 'idea-canvas',
    gate: (e) => e.stageDone('idea_validation') },
  // "First scoring (Caution/Go)" — the score must CLEAR the caution bar, not
  // just exist; a "weak" score is not a rung earned.
  { level: 2, key: 'first_score_gate_ab', labelKey: 'first-score',
    gate: (e) => e.score != null && e.score >= IRL_SCORE_BAR && e.trackDone('1A') && e.trackDone('1B') },
  { level: 3, key: 'gate_c_loop1', labelKey: 'psf',
    gate: (e) => e.trackDone('1C') && e.wtpRate != null && e.wtpRate >= IRL_WTP_BAR },
  // Business Essentials is persona + business_model (mirrors the phase spine's
  // definition in journey/phases.ts) — gating on business_model alone let the
  // two surfaces disagree about what completing this phase means.
  { level: 4, key: 'business_essentials_loop2', labelKey: 'business',
    gate: (e) => e.stageDone('persona') && e.stageDone('business_model')
      && e.ltvCacRatio != null && e.ltvCacRatio >= IRL_LTV_CAC_BAR },
  { level: 5, key: 'build_test_loop3', labelKey: 'build',
    gate: (e) => e.stageDone('build_launch') && e.conversionRate != null && e.conversionRate >= IRL_CONVERSION_BAR },
  { level: 6, key: 'mvp_release_loop4', labelKey: 'mvp',
    gate: (e) => e.stageDone('build_launch') && e.activationRate != null && e.activationRate >= IRL_ACTIVATION_BAR },
];

/**
 * Levels 7-9 — the paid add-on modules. Founder spec: "ogni modulo è un punto.
 * C'è un ordine consigliato ma NON vincolante" — so these are INDEPENDENT: each
 * completed module is +1 in any order. (Running them through the contiguous
 * walk meant completing Fundraising without GTM earned nothing at all — two
 * paid modules, zero movement.)
 *
 * They only start counting once the core 6 are earned, otherwise the number
 * would imply phases the founder never did.
 */
export const IRL_ADDON_LADDER: readonly IrlLevel[] = [
  { level: 7, key: 'addon_gtm', labelKey: 'gtm',
    gate: (e) => e.addOns.has('gtm_orchestration') },
  { level: 8, key: 'addon_fundraising', labelKey: 'fundraising',
    gate: (e) => e.addOns.has('fundraising_readiness') },
  { level: 9, key: 'addon_operations', labelKey: 'operations',
    gate: (e) => e.addOns.has('operations') },
];

/** The full 1-9 ladder (core then add-ons) — for display/enumeration. */
export const IRL_LADDER: readonly IrlLevel[] = [...IRL_CORE_LADDER, ...IRL_ADDON_LADDER];

export interface IrlResult {
  /** Highest contiguous satisfied level (0 = nothing earned yet). */
  level: number;
  of: number;
  /** The first unsatisfied level's key — what to earn next (null if maxed). */
  nextKey: string | null;
}

/**
 * IRL, in two parts:
 *
 *  1-6  the highest CONTIGUOUS core level whose evidence gate holds. Contiguous
 *       (not "count of passing gates") so a lower gate failing after a pivot
 *       pulls the whole index down — you can't be investment-ready at 4 with a
 *       broken level-2 signal underneath.
 *  7-9  +1 per completed add-on module, in ANY order (founder spec: "ogni
 *       modulo è un punto, ordine consigliato ma non vincolante"), and only
 *       once the core 6 are earned.
 */
export function computeIRL(e: IrlEvidence): IrlResult {
  let level = 0;
  for (const rung of IRL_CORE_LADDER) {
    if (!rung.gate(e)) break;
    level = rung.level;
  }

  if (level < IRL_CORE_MAX) {
    // Still climbing the sequential ladder — the next rung is the one that failed.
    const next = IRL_CORE_LADDER.find((r) => r.level === level + 1) ?? null;
    return { level, of: IRL_MAX, nextKey: next ? next.key : null };
  }

  // Core complete: each finished module is a point, order-independent.
  const earned = IRL_ADDON_LADDER.filter((r) => r.gate(e));
  const nextAddon = IRL_ADDON_LADDER.find((r) => !r.gate(e)) ?? null;
  return {
    level: Math.min(IRL_MAX, IRL_CORE_MAX + earned.length),
    of: IRL_MAX,
    nextKey: nextAddon ? nextAddon.key : null,
  };
}
