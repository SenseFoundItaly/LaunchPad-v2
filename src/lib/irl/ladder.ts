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
/**
 * The scale is 1-9 — never 0 (founder, 2026-08-04: "IRL va da 1 a 9, non può
 * essere 0. Di default parte da 1"). A new project sits ON the bottom rung, it
 * is not off the ladder, and "0/9" read as a failing grade for simply having
 * started.
 *
 * This is a DISPLAY floor only. `earned` stays honest (it can be 0) so the
 * regression check and the floor logic keep working on real evidence — the
 * founder sees 1, the engine still knows nothing has been proven yet.
 */
export const IRL_MIN = 1;
/** The last SEQUENTIAL level. 1-6 are the phase ladder (contiguous); 7-9 are
 *  the independent paid add-on modules. */
export const IRL_CORE_MAX = 6;

// Evidence bars — policy, SF-set, mirrored from the loop thresholds. Central so
// the ladder and the loops can never disagree on what "passing" means.
export const IRL_WTP_BAR = 0.30;        // Loop 1 (PSF)
/**
 * LTV/CAC viability — the SINGLE source of truth for this number.
 *
 * Iteration Cycle 2A: "Unit economics viable — LTV/CAC ratio (target minimo:
 * >= 3x)". Loop 2 fires below it, IRL level 4 requires it, and the Stage-4
 * `unit_econ_viable` check reads it. Those three USED TO DISAGREE — the stage
 * check passed at >= 1x while the loop and the ladder demanded 3x, so a
 * founder could turn Business Model green and be bounced by the BM Stress Test
 * one step later. Import this constant; never re-type the number.
 *
 * Lives here because ladder.ts is dependency-free by design (type-only import),
 * so journey checks and loop modules can both import it without a cycle.
 */
export const IRL_LTV_CAC_BAR = 3;       // Loop 2 (BM stress test) + Stage-4 gate
export const IRL_CONVERSION_BAR = 0.05; // Loop 3 (market response)
export const IRL_ACTIVATION_BAR = 0.20; // Loop 4 (MVP test verdict)
/**
 * Rung 2's score bar — the Clarity Score GO threshold.
 *
 * History: this was 40 (the caution floor in score-display.ts's band()),
 * reading the founder's "First scoring (Caution/Go)" as "clear the caution
 * band". The Clarity/Startup split (changelog 4/08, PR #401) gave the first
 * score explicit verdicts — GO >= 70, PIVOT PARZIALE 40-69, NO GO < 40, defined
 * in launchpad-skills/clarity-scoring/SKILL.md — and a rung "earned" on a score
 * whose own verdict says "fix something first" contradicts itself. Raised to
 * the GO bar on 2026-08-07 (decision adopted with Mike; Luca can veto).
 *
 * Blast radius, measured before raising: 6 projects sat in the 40-69 band and
 * NONE had tracks 1A+1B done, so no earned rung was revoked — the change is
 * behaviour-neutral today and honest going forward. The high-water floor
 * (#296) would have protected any that existed.
 */
export const IRL_CLARITY_GO_BAR = 70;
/** @deprecated old name, kept for the quadrant module's docs — same value. */
export const IRL_SCORE_BAR = IRL_CLARITY_GO_BAR;

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
   *  to clear IRL_CLARITY_GO_BAR (a Clarity GO), not merely to exist. */
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
    gate: (e) => e.score != null && e.score >= IRL_CLARITY_GO_BAR && e.trackDone('1A') && e.trackDone('1B') },
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
  /** The level shown to the founder — max(earned, floor). */
  level: number;
  of: number;
  /** The first unsatisfied level's key — what to earn next (null if maxed). */
  nextKey: string | null;
  /** What the evidence supports RIGHT NOW, ignoring the floor. */
  earned: number;
  /**
   * True when evidence has slipped below a level already earned — `level` is
   * being held up by the floor. The UI says "evidenza sotto soglia" instead of
   * moving the number: founder spec 2026-07-23, "l'IRL non regredisce; potrebbe
   * scendere solo in caso di pivot pesante".
   */
  regressed: boolean;
}

/**
 * The high-water floor. IRL is "how investable are you" — a milestone, not a
 * live gauge — so a dip in one signal must not un-earn it. Only a PIVOT clears
 * the floor, because that is the founder declaring the work has to be redone
 * (founder spec: "se… costringe il founder a tornare indietro e rifare un
 * intero stage daccapo, allora si potrebbe considerare un abbassamento").
 *
 * Deliberately NOT a stored level that only ever rises: the floor is cleared on
 * PIVOT and then re-accumulates from live evidence, so it can never drift into
 * claiming a rung the evidence never supported.
 */
export interface IrlFloor {
  /** Highest level previously earned, or 0/null when none is on record. */
  level: number | null;
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
export function computeIRL(e: IrlEvidence, floor?: IrlFloor): IrlResult {
  let earnedLevel = 0;
  for (const rung of IRL_CORE_LADDER) {
    if (!rung.gate(e)) break;
    earnedLevel = rung.level;
  }

  if (earnedLevel >= IRL_CORE_MAX) {
    // Core complete: each finished module is a point, order-independent.
    const mods = IRL_ADDON_LADDER.filter((r) => r.gate(e));
    earnedLevel = Math.min(IRL_MAX, IRL_CORE_MAX + mods.length);
  }

  // The floor holds the number up; `nextKey` always describes what the LIVE
  // evidence needs next, so a regressed project is told what to restore rather
  // than what comes after a level it is no longer supporting.
  const floorLevel = floor?.level ?? 0;
  // IRL_MIN last: the scale starts at 1, so an unproven project shows 1, not 0.
  const level = Math.max(earnedLevel, floorLevel, IRL_MIN);

  const nextKey = earnedLevel < IRL_CORE_MAX
    ? (IRL_CORE_LADDER.find((r) => r.level === earnedLevel + 1)?.key ?? null)
    : (IRL_ADDON_LADDER.find((r) => !r.gate(e))?.key ?? null);

  return { level, of: IRL_MAX, nextKey, earned: earnedLevel, regressed: earnedLevel < floorLevel };
}
