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

// Evidence bars — policy, SF-set, mirrored from the loop thresholds. Central so
// the ladder and the loops can never disagree on what "passing" means.
export const IRL_WTP_BAR = 0.30;        // Loop 1 (PSF)
export const IRL_LTV_CAC_BAR = 3;       // Loop 2 (BM stress test)
export const IRL_CONVERSION_BAR = 0.05; // Loop 3 (market response)
export const IRL_ACTIVATION_BAR = 0.20; // Loop 4 (MVP test verdict)

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
  /** A real project score has been produced (overall_score > 0). */
  hasScore: boolean;
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

export const IRL_LADDER: readonly IrlLevel[] = [
  { level: 1, key: 'idea_canvas', labelKey: 'idea-canvas',
    gate: (e) => e.stageDone('idea_validation') },
  { level: 2, key: 'first_score_gate_ab', labelKey: 'first-score',
    gate: (e) => e.hasScore && e.trackDone('1A') && e.trackDone('1B') },
  { level: 3, key: 'gate_c_loop1', labelKey: 'psf',
    gate: (e) => e.trackDone('1C') && e.wtpRate != null && e.wtpRate >= IRL_WTP_BAR },
  { level: 4, key: 'business_essentials_loop2', labelKey: 'business',
    gate: (e) => e.stageDone('business_model') && e.ltvCacRatio != null && e.ltvCacRatio >= IRL_LTV_CAC_BAR },
  { level: 5, key: 'build_test_loop3', labelKey: 'build',
    gate: (e) => e.stageDone('build_launch') && e.conversionRate != null && e.conversionRate >= IRL_CONVERSION_BAR },
  { level: 6, key: 'mvp_release_loop4', labelKey: 'mvp',
    gate: (e) => e.stageDone('build_launch') && e.activationRate != null && e.activationRate >= IRL_ACTIVATION_BAR },
  { level: 7, key: 'addon_gtm', labelKey: 'gtm',
    gate: (e) => e.addOns.has('gtm_orchestration') },
  { level: 8, key: 'addon_fundraising', labelKey: 'fundraising',
    gate: (e) => e.addOns.has('fundraising_readiness') },
  { level: 9, key: 'addon_operations', labelKey: 'operations',
    gate: (e) => e.addOns.has('operations') },
];

export interface IrlResult {
  /** Highest contiguous satisfied level (0 = nothing earned yet). */
  level: number;
  of: number;
  /** The first unsatisfied level's key — what to earn next (null if maxed). */
  nextKey: string | null;
}

/**
 * IRL = the highest CONTIGUOUS level whose evidence gate holds. Contiguous
 * (not "count of passing gates") so a lower gate failing after a pivot pulls
 * the whole index down — you can't be "investment-ready at 6" with a broken
 * level-3 signal underneath.
 */
export function computeIRL(e: IrlEvidence): IrlResult {
  let level = 0;
  for (const rung of IRL_LADDER) {
    if (!rung.gate(e)) break;
    level = rung.level;
  }
  const next = IRL_LADDER.find((r) => r.level === level + 1) ?? null;
  return { level, of: IRL_MAX, nextKey: next ? next.key : null };
}
