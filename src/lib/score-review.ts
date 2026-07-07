/**
 * Road-1 weak-section review — the deterministic middle step after a
 * startup-scoring run (audit B1: the walkthrough's "review weak sections"
 * step had no implementation, so scoring jumped straight to validation).
 *
 * After a COMPLETED startup-scoring run, both callers (the /skills run=1 SSE
 * and POST /score) offer the founder one option-set: an option per weak
 * dimension (< 60/100, worst 3 first) whose click prefills a "walk me through
 * why {dim} scored {n}/100" chat prompt, plus a final "proceed to validation"
 * option. Pure steering — no skill_id, no auto-run, nothing greens; a click
 * only sends a chat message.
 *
 * Idempotency: memory_event `score_review_offered`, one offer per scoring run
 * (a marker OLDER than scores.scored_at means the founder re-scored since —
 * offer again for the fresh scorecard).
 */

import { get } from '@/lib/db';
import { recordEvent, lastEventOfType } from '@/lib/memory/events';
import { weakestDimensions } from '@/lib/score-summary';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';

export const SCORE_REVIEW_ARTIFACT_ID = 'opt_score_review';

/**
 * scores.dimensions is written on mixed scales: parseScoreSummary lands 0-100,
 * the radar-chart / score-card persisters can land 0-10, and legacy rows may be
 * a double-encoded string. Normalize to a 0-100 object map (null = unusable).
 */
function normalizeDims(raw: unknown): Record<string, number> | null {
  let d = raw;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { return null; }
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const entries = Object.entries(d as Record<string, unknown>).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]),
  );
  if (entries.length === 0) return null;
  const scale = entries.every(([, v]) => v <= 10) ? 10 : 1;
  return Object.fromEntries(entries.map(([k, v]) => [k, Math.round(v * scale)]));
}

/**
 * Build the review option-set artifact block for the project's CURRENT score,
 * or null when there's nothing to review (no dims, no weak dims, already
 * offered for this scoring run). Records the idempotency marker on success.
 * Non-throwing — a failed offer must never break the scoring run that hosts it.
 */
export async function maybeBuildScoreReviewOptionSet(
  projectId: string,
  ownerUserId: string,
): Promise<string | null> {
  try {
    if (!ownerUserId) return null;
    const row = await get<{ dimensions: unknown; overall_score: number | null; scored_at: string | null }>(
      'SELECT dimensions, overall_score, scored_at FROM scores WHERE project_id = ?',
      projectId,
    );
    if (!row) return null;
    const dims = normalizeDims(row.dimensions);
    const weak = weakestDimensions(dims, { max: 3, threshold: 60 });
    if (weak.length === 0) return null;

    // One offer per scoring run: a marker at/after scored_at ⇒ already offered.
    const marker = await lastEventOfType(ownerUserId, projectId, 'score_review_offered');
    if (marker && (!row.scored_at || new Date(marker.created_at) >= new Date(row.scored_at))) {
      return null;
    }

    const locale = await resolveLocale(ownerUserId, projectId);
    const options: Array<{ id: string; label: string; description: string }> = weak.map((w, i) => ({
      id: `review_dim_${i}`,
      label: translate(locale, 'score-review.option-label', { dim: w.name, score: w.score }),
      description: translate(locale, 'score-review.option-desc', { dim: w.name, score: w.score }),
    }));
    options.push({
      id: 'proceed_validation',
      label: translate(locale, 'score-review.proceed'),
      description: translate(locale, 'score-review.proceed-desc'),
    });

    await recordEvent({
      userId: ownerUserId,
      projectId,
      eventType: 'score_review_offered',
      payload: { overall: row.overall_score, weak },
    });

    const body = { prompt: translate(locale, 'score-review.prompt'), options };
    return `:::artifact{"type":"option-set","id":"${SCORE_REVIEW_ARTIFACT_ID}"}\n${JSON.stringify(body)}\n:::`;
  } catch (err) {
    console.warn('[score-review] offer failed (non-fatal):', (err as Error).message);
    return null;
  }
}
