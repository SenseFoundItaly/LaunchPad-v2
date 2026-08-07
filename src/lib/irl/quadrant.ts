/**
 * Score × IRL — the two-axis reading an accelerator or a VC does at a glance.
 *
 * Founder framing (2026-08-04), verbatim:
 *   Score alto ma IRL basso  -> progetto promettente ma ancora troppo acerbo
 *   Score alto e IRL alto    -> startup da tenere d'occhio
 *   Score basso e IRL alto   -> ben sviluppata ma con potenziale basso o inespresso
 *   Score basso e IRL basso  -> progetto da scartare o pivotare
 *
 * The two axes measure different things and must not be collapsed:
 *   Score = how promising the IDEA is. Volatile by design — it moves with
 *           asset quality, feedback and execution speed.
 *   IRL   = how ready you are to be INVESTED IN. Earned, sticky, floored
 *           (#296); each point has to be sweated for.
 *
 * Pure — no DB, no i18n, no React. Returns a key; the caller localizes.
 */

import { band } from '@/lib/score-display';

export type QuadrantKey =
  /** Score high, IRL high — the one worth tracking. */
  | 'watch'
  /** Score high, IRL low — promising, still raw. */
  | 'promising_raw'
  /** Score low, IRL high — well built, weak or unexpressed potential. */
  | 'developed_low_potential'
  /** Score low, IRL low — discard or pivot. */
  | 'discard_or_pivot';

/**
 * The IRL "developed" bar. Level 4 is the first rung where the BUSINESS is
 * proven and not just the idea: persona + business model complete AND
 * LTV/CAC ≥ 3×. Below that a project has an argument; at 4 it has unit
 * economics.
 *
 * Deliberately absolute, not "half of whatever is reachable today". The
 * reachable ceiling is currently 4 (#338) because upstream metric feeds are
 * missing — scaling the bar to that would mean a project's quadrant silently
 * changed the day an unrelated PR merged. The bar is a statement about
 * evidence, so it stays put while the ceiling rises.
 */
export const IRL_DEVELOPED_BAR = 4;

/**
 * The score bar. Reuses `band()` so this can never disagree with the badge the
 * founder sees: 'strong' (≥70) and 'promising' (≥55) are high; 'caution' (≥40)
 * and 'weak' are not.
 *
 * Note: IRL rung 2 now uses the Clarity GO bar (70, see ladder.ts) — the two
 * score is real enough to earn rung 2. Clearing the floor to be counted is not
 * the same as being promising.
 */
export function scoreIsHigh(score: number): boolean {
  const key = band(score).key;
  return key === 'score.band-strong' || key === 'score.band-promising';
}

/**
 * Place a project on the two-axis map.
 *
 * Returns `null` when there is no score yet — an unscored project is not
 * "low potential", it is unmeasured, and guessing would put a verdict on a
 * founder who has not been assessed. Same discipline as the ladder treating a
 * null signal as "no data ≠ passing".
 */
export function quadrantFor(score: number | null | undefined, irlLevel: number): QuadrantKey | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null;
  const high = scoreIsHigh(score);
  const developed = irlLevel >= IRL_DEVELOPED_BAR;
  if (high) return developed ? 'watch' : 'promising_raw';
  return developed ? 'developed_low_potential' : 'discard_or_pivot';
}

/** i18n key for a quadrant's founder-facing line. */
export function quadrantMessageKey(q: QuadrantKey): `irl.quadrant-${QuadrantKey}` {
  return `irl.quadrant-${q}`;
}
