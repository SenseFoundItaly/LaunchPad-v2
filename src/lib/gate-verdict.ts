/**
 * Validation Gate verdict — ASK the founder for the go/no-go once every piece
 * of gate evidence is in (founder request 2026-08-04: "verdict go/no go").
 *
 * Propose-don't-decide, like every other gate write: this module only stages a
 * `validation_proposal` pending_action carrying a single `gate_verdict` item.
 * Nothing is recorded until the founder Applies it — `applyValidationProposal`
 * then stamps `research.gate_verdict` (migration 037) and the `gate_verdict`
 * check greens.
 *
 * Why this module has to exist: `gate_verdict` is the one gate check no amount
 * of founder WORK can close, because it is a decision, not evidence. Without a
 * prompt the founder would sit at "everything green except one row" with no
 * affordance — the §4 dead-end the loops already learned to avoid.
 *
 * Apply = GO. Rejecting the card records NOTHING and leaves the gate open,
 * which is the safe direction: the gate can never green without an explicit yes.
 *
 * ── Idempotency: deliberately NOT the phase1-watchers rule ──────────────────
 * The watcher proposer records a permanent marker so a rejected proposal STICKS
 * ("the founder said no once"). Copying that here shipped a dead end: reject
 * writes no verdict, the marker blocks re-asking, and `gate_verdict` is red
 * forever with no affordance — the gate becomes uncompletable.
 *
 * The asymmetry is the point. A watcher is a SUGGESTION, so "no" can be final.
 * The verdict is a REQUIRED step, so "no" can only mean "not now" — otherwise
 * declining once bricks the project (linee guida §4: the system must never
 * dead-end the founder).
 *
 * So the guard is state, not history: propose unless a verdict is already
 * recorded (`shouldProposeGateVerdict`) or a card carrying this item is already
 * open. `stageOrMergeItems` is the real backstop — it refuses to duplicate an
 * item already staged on an open card. The marker event is still written, but
 * purely as an audit trail; it no longer gates anything.
 */

import { query } from '@/lib/db';
import { buildProjectSnapshot } from '@/lib/journey';
import { shouldProposeGateVerdict } from '@/lib/journey/stage-2-market-validation';
import { stageValidationItemsFromRaw } from '@/lib/auto-stage-validation';
import { recordEvent } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';

/** memory_events marker — an audit trail of when we asked. NOT an idempotency
 *  gate: see the asymmetry note above. */
export const GATE_VERDICT_EVENT = 'gate_verdict_proposed' as const;

/** True when an unresolved card already carries the go/no-go item — don't
 *  stack a second one on top of it. Tolerates legacy double-encoded payloads
 *  by simply not matching (stageOrMergeItems then no-ops instead). */
async function verdictCardAlreadyOpen(projectId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM pending_actions
      WHERE project_id = ? AND action_type = 'validation_proposal'
        AND status IN ('pending','edited')
        AND (payload->'items' @> '[{"kind":"gate_verdict"}]'
          OR edited_payload->'items' @> '[{"kind":"gate_verdict"}]')
      LIMIT 1`,
    projectId,
  ).catch(() => [] as { id: string }[]);
  return rows.length > 0;
}

/**
 * Stage the go/no-go card if (and only if) the gate evidence is complete, no
 * verdict is on record, and no card is already waiting for them.
 *
 * Non-fatal by construction: every failure path returns false rather than
 * throwing, so a proposal problem can never break the caller's request.
 */
export async function maybeProposeGateVerdict(projectId: string): Promise<boolean> {
  try {
    // The marker event is user-scoped (mirrors phase1-watchers).
    const proj = await query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM projects WHERE id = ?',
      projectId,
    );
    const ownerUserId = proj[0]?.owner_user_id || '';
    if (!ownerUserId) return false;

    // State, not history: a card the founder already has, or a decision already
    // made. A REJECTED card must not block a fresh ask — that was the dead end.
    if (await verdictCardAlreadyOpen(projectId)) return false;

    const snapshot = await buildProjectSnapshot(projectId);
    if (!shouldProposeGateVerdict(snapshot)) return false;

    const locale = await resolveLocale('', projectId);
    const prompt = locale === 'it'
      ? 'Tutte le prove del Validation Gate sono raccolte. Confermi il GO per procedere alla fase successiva?'
      : 'Every piece of Validation Gate evidence is in. Do you call GO to move to the next phase?';

    const { staged } = await stageValidationItemsFromRaw(
      projectId,
      [{
        kind: 'gate_verdict',
        value: prompt,
        sources: [{
          type: 'internal',
          title: locale === 'it' ? 'Prove del gate complete' : 'Gate evidence complete',
          ref: 'research',
          ref_id: projectId,
        }],
      }],
      GATE_VERDICT_EVENT,
    );
    if (!staged) return false;

    // Audit trail only — every ask is recorded, and re-asks are expected after
    // a "not now". This must NOT become an idempotency gate again.
    await recordEvent({ userId: ownerUserId, projectId, eventType: GATE_VERDICT_EVENT, payload: { locale } });
    return true;
  } catch (err) {
    console.warn('[gate-verdict] proposal failed (non-fatal):', (err as Error).message);
    return false;
  }
}
