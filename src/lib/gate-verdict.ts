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
 * Idempotency mirrors phase1-watchers: a memory_events marker, recorded only
 * once a proposal was actually staged.
 */

import { query } from '@/lib/db';
import { buildProjectSnapshot } from '@/lib/journey';
import { shouldProposeGateVerdict } from '@/lib/journey/stage-2-market-validation';
import { stageValidationItemsFromRaw } from '@/lib/auto-stage-validation';
import { recordEvent, lastEventOfType } from '@/lib/memory/events';
import { resolveLocale } from '@/lib/i18n/resolve-locale';

/** memory_events marker — one verdict proposal per project. */
export const GATE_VERDICT_EVENT = 'gate_verdict_proposed' as const;

/**
 * Stage the go/no-go card if (and only if) the gate evidence is complete, no
 * verdict is on record, and we have not already asked.
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

    if (await lastEventOfType(ownerUserId, projectId, GATE_VERDICT_EVENT)) return false;

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

    // Marker only once a proposal actually landed, so a failed run can retry.
    await recordEvent({ userId: ownerUserId, projectId, eventType: GATE_VERDICT_EVENT, payload: { locale } });
    return true;
  } catch (err) {
    console.warn('[gate-verdict] proposal failed (non-fatal):', (err as Error).message);
    return false;
  }
}
