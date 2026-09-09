/**
 * Stage handoff — the message that hands the founder the next stage.
 *
 * Changelog 05/09 item 5: "Al termine dello stage Idea Canvas manca un
 * messaggio in chat che guida l'utente al prossimo stage."
 *
 * The spine turned green and the chat said nothing. The founder had just
 * finished the one stage the product had walked him through step by step, and
 * the reward was silence — no "done", no "here's what's next", no way to tell
 * whether finishing had registered at all. Everything needed to continue was on
 * screen, in a side panel he had no reason to look at in that moment.
 *
 * So: when a stage goes green, say so in the thread the founder is actually
 * reading, and offer the first moves of the next one.
 *
 * Scope note — this is written for any stage, keyed on the stage number, but
 * only Stage 1 is wired on. Stages 3-7 have no task content yet (changelog item
 * 1), so a handoff into them would promise a walkthrough that does not exist.
 * When item 1 lands, widen HANDOFF_FROM_STAGES; nothing else has to change.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import { translate } from '@/lib/i18n/messages';
import { buildProjectSnapshot, activeStageFor } from '@/lib/journey';

/** Stages whose completion is worth a handoff. See the scope note above: this
 *  is a list, not a range, precisely so turning on more is a one-line decision
 *  someone makes deliberately. */
export const HANDOFF_FROM_STAGES = new Set<number>([1]);

export const STAGE_HANDOFF_EVENT = 'stage_handoff_proposed' as const;

/** Stable, stage-specific tag: one handoff per stage, and a Stage-1 handoff
 *  must never suppress a later one. */
const cardTag = (fromStage: number) => `opt_stage_handoff_${fromStage}`;

/** True when this stage's handoff has already been shown. Unlike the gate
 *  verdict — a REQUIRED step that guards on state — a handoff is a one-time
 *  announcement, so history is the right guard: re-announcing a stage the
 *  founder finished last week would be noise, not help. */
async function handoffAlreadySent(projectId: string, fromStage: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM chat_messages
      WHERE project_id = ? AND role = 'assistant' AND content LIKE ?
      LIMIT 1`,
    projectId,
    `%${cardTag(fromStage)}%`,
  ).catch(() => [] as { id: string }[]);
  return rows.length > 0;
}

/**
 * Announce a completed stage and offer the first moves of the next one.
 *
 * Non-throwing by construction: every failure path returns false, so a handoff
 * problem can never break the caller's request.
 */
export async function maybeProposeStageHandoff(projectId: string): Promise<boolean> {
  try {
    const proj = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    const ownerUserId = proj[0]?.owner_user_id || '';
    if (!ownerUserId) return false;

    const snapshot = await buildProjectSnapshot(projectId);
    const active = activeStageFor(snapshot);
    // "Stage N is done" == the evaluator has moved on to N+1. Reading it this
    // way rather than re-deriving completion keeps one definition of done.
    const fromStage = active.stage.number - 1;
    if (!HANDOFF_FROM_STAGES.has(fromStage)) return false;
    if (await handoffAlreadySent(projectId, fromStage)) return false;

    const locale = await resolveLocale(ownerUserId, projectId);
    // Options are plain prompts, not skill runs. The founder has just been told
    // where they are; firing a paid analysis off that same click would spend
    // their credits on a decision they have not made yet — and one of these
    // (market sizing) has a question of its own to answer first (item 7d).
    const options = [
      { id: 'stage_handoff_market', label: translate(locale, 'stage-handoff.option-market'),
        description: translate(locale, 'stage-handoff.option-market-desc') },
      { id: 'stage_handoff_competitors', label: translate(locale, 'stage-handoff.option-competitors'),
        description: translate(locale, 'stage-handoff.option-competitors-desc') },
      { id: 'stage_handoff_overview', label: translate(locale, 'stage-handoff.option-overview'),
        description: translate(locale, 'stage-handoff.option-overview-desc') },
    ];
    const body = { prompt: translate(locale, 'stage-handoff.prompt'), options };
    const content = `:::artifact{"type":"option-set","id":"${cardTag(fromStage)}_${projectId.slice(-8)}"}\n${JSON.stringify(body)}\n:::`;

    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
       VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
      generateId('msg'), projectId, content, new Date().toISOString(), ownerUserId,
    );
    await recordEvent({
      userId: ownerUserId, projectId, eventType: STAGE_HANDOFF_EVENT,
      payload: { from_stage: fromStage, to_stage: active.stage.number, locale },
    });
    return true;
  } catch (err) {
    console.warn('[stage-handoff] proposal failed (non-fatal):', (err as Error).message);
    return false;
  }
}
