/**
 * Shared score-display helpers — used by Home's ScorePanel AND the in-chat
 * baseline score card so the two never drift (the founder complained the
 * copilot showed one number/shape and Home another). Pure: no React, no DOM,
 * so it imports cleanly on the server too (artifact-persistence reuses the
 * baseline-title test).
 */

import type { MessageKey } from '@/lib/i18n/messages';

export interface ScoreDimensionLite { name: string; score: number }

/**
 * scores.dimensions is a JSONB object map (e.g. {"Problem": 7.2}); older or
 * corrupted rows may be a JSON string or an array of {name,score}. Normalize
 * all three shapes into [{name, score}].
 */
export function normalizeDimensions(raw: unknown): ScoreDimensionLite[] {
  let d = raw;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return []; }
  }
  if (Array.isArray(d)) {
    return d.filter(
      (x): x is ScoreDimensionLite =>
        !!x && typeof x === 'object' &&
        typeof (x as ScoreDimensionLite).name === 'string' &&
        typeof (x as ScoreDimensionLite).score === 'number',
    );
  }
  if (d && typeof d === 'object') {
    return Object.entries(d as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
      .map(([name, v]) => ({ name, score: v as number }));
  }
  return [];
}

/**
 * scores.* canon is 0-100, but rows written before the write-side normalization
 * (chat score-card/gauge artifacts prompted with maxScore:10) carry 0-10
 * values. ≤10 reads as the 0-10 scale (mirrors baselineScore100 in stage-1).
 */
export function to100(v: number): number {
  return v <= 10 ? v * 10 : v;
}

/**
 * Qualitative band — aligned with the anti-sycophancy scoring guardrails
 * (70+ = strong/verified, 40-or-below = serious warning). Colors mirror the spine.
 */
export function band(score: number): { key: MessageKey; color: string } {
  if (score >= 70) return { key: 'score.band-strong', color: 'var(--moss)' };
  if (score >= 55) return { key: 'score.band-promising', color: 'var(--accent)' };
  if (score >= 40) return { key: 'score.band-caution', color: 'var(--clay)' };
  return { key: 'score.band-weak', color: 'var(--clay)' };
}

/**
 * Titles that mark a score artifact as THE project-level baseline (vs a
 * per-dimension or competitor score): must name both a score word and an
 * overall/baseline qualifier, EN or IT. Kept tight — a generic "Competitor
 * radar" or single-dimension card must never be treated as the baseline.
 * Single source of truth: artifact-persistence (write side) and the in-chat
 * card renderer (read side) both consult this.
 */
export const OVERALL_SCORE_TITLE_RE =
  /\b(overall|startup|baseline|complessivo|complessiva|generale)\b[\s\S]*\b(score|scoring|punteggio)\b|\b(score|scoring|punteggio)\b[\s\S]*\b(overall|startup|baseline|complessivo|complessiva|generale)\b/i;

export function isBaselineScoreTitle(title: string | undefined | null): boolean {
  return OVERALL_SCORE_TITLE_RE.test(title ?? '');
}


/**
 * Present any artifact score on the 0-100 canon.
 *
 * Score artifacts carry their OWN `max`, so whatever scale the model emits is
 * what the founder sees. That is how a 6.8 reached the Canvas months after the
 * 0-100 unification (#249) — the canon was enforced on the write side and on
 * Home, but the artifact renderers trusted the payload.
 *
 * Founder, 21/07: "perché copilot in decimi e home in centesimi?" — asked
 * again on 04/08 with a screenshot. Enforcing it HERE, at the renderer, is
 * what makes the question stop coming back: the model can emit any scale it
 * likes and the founder still sees one.
 *
 * Proportional rather than a special-case for /10, so an unexpected /5 or /20
 * is normalised too instead of rendering as a wildly wrong percentage.
 */
export function toScore100(score: number, max: number | undefined | null): number {
  const m = typeof max === 'number' && max > 0 ? max : 100;
  if (!Number.isFinite(score)) return 0;
  const pct = score / m;
  return Math.round(Math.max(0, Math.min(1, pct)) * 100);
}
