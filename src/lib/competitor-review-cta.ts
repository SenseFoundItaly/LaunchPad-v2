/**
 * The call to action after a competitor analysis.
 *
 * Changelog 05/09 item 7f: "Quando runna analisi competitor farei generare un
 * report dettagliato nel canvas a dx + una chiara call to action in chat con
 * due possibilità → 1) Cercare ulteriori competitors; 2) andare nella sezione
 * knowledge per approvare i competitors trovati."
 *
 * This is the CTA half. It matters more than it looks: competitors extracted
 * from a chat table are staged as `reviewed_state='pending'` graph nodes on
 * purpose (2026-06-12 directive — an agent-emitted table must not silently
 * green the spine). So the founder watches an analysis run, sees a table, and
 * the `competitors_mapped` check stays red, because the one step that would
 * close it — approving them — happens on a page nothing pointed them to.
 *
 * Exactly two options, as specified. A third would blur the decision, and the
 * decision is genuinely binary here: the list is either thin or it is ready.
 *
 * The "report dettagliato nel canvas" half is NOT here. No competitor-report
 * artifact exists (chat renders these as a ComparisonTable), so it would be a
 * new card — and the PROPOSAL at the foot of the same changelog moves
 * competitors into a CRM-style surface, which is exactly the thing such a card
 * would have to be rebuilt for. Held until that call is made.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';

/** Stable artifact id fragment, so an unanswered CTA is findable. */
const CARD_TAG = 'opt_competitor_review';

export const COMPETITOR_REVIEW_EVENT = 'competitor_review_proposed' as const;

/** Competitors staged by a chat table and still awaiting the founder's yes. */
export async function pendingCompetitorCount(projectId: string): Promise<number> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM graph_nodes
      WHERE project_id = ? AND node_type = 'competitor' AND reviewed_state = 'pending'`,
    projectId,
  ).catch(() => [] as { n: number }[]);
  return Number(rows[0]?.n ?? 0);
}

async function ctaAlreadyOpen(projectId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM chat_messages
      WHERE project_id = ? AND role = 'assistant' AND content LIKE ?
      LIMIT 1`,
    projectId,
    `%${CARD_TAG}%`,
  ).catch(() => [] as { id: string }[]);
  return rows.length > 0;
}

/**
 * Stage the two-option CTA when competitors are waiting for approval.
 *
 * Guarded on STATE — competitors are pending — rather than on history. Approving
 * them empties the pending set and the card stops being staged on its own; a
 * founder who ignores it keeps ONE card, not one per turn. Non-throwing: a CTA
 * problem must never break the turn that produced the analysis.
 */
export async function maybeProposeCompetitorReview(projectId: string): Promise<boolean> {
  try {
    const pending = await pendingCompetitorCount(projectId);
    if (pending === 0) return false;
    if (await ctaAlreadyOpen(projectId)) return false;

    const proj = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    const ownerUserId = proj[0]?.owner_user_id || '';
    if (!ownerUserId) return false;

    const locale = await resolveLocale(ownerUserId, projectId);
    const options = [
      {
        id: 'competitor_review_more',
        label: translate(locale, 'competitor-cta.find-more'),
        description: translate(locale, 'competitor-cta.find-more-desc'),
      },
      {
        id: 'competitor_review_approve',
        label: translate(locale, 'competitor-cta.approve'),
        description: translate(locale, 'competitor-cta.approve-desc', { count: pending }),
        // Navigation, not a message: the founder's next move is on another
        // page, and sending "I choose: go to knowledge" to the agent would have
        // it narrate a journey it cannot make on their behalf.
        navigate_to: 'knowledge' as const,
      },
    ];
    const body = { prompt: translate(locale, 'competitor-cta.prompt', { count: pending }), options };
    const content = `:::artifact{"type":"option-set","id":"${CARD_TAG}_${projectId.slice(-8)}"}\n${JSON.stringify(body)}\n:::`;

    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, content, new Date().toISOString(), ownerUserId,
    );
    await recordEvent({
      userId: ownerUserId, projectId, eventType: COMPETITOR_REVIEW_EVENT, payload: { pending, locale },
    });
    return true;
  } catch (err) {
    console.warn('[competitor-cta] proposal failed (non-fatal):', (err as Error).message);
    return false;
  }
}
