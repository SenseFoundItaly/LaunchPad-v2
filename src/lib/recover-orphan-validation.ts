import { createPendingAction } from './pending-actions';

/** The row shape createPendingAction resolves to — inferred, not re-declared. */
type StagedAction = Awaited<ReturnType<typeof createPendingAction>>;

/**
 * Recover an Apply whose pending_actions row never existed.
 *
 * The Co-pilot is supposed to reach the "Valida le prove" card through the
 * propose_validation tool, which writes the row FIRST and embeds its real id.
 * It sometimes hand-writes the `:::artifact{"type":"validation-proposal"}`
 * block instead and fills the id field with a placeholder — measured on prod
 * 2026-09-08 20:58, where the value was the literal string `"pending"`. The row
 * never existed, so Apply answered 404 "Action not found".
 *
 * That 404 is not cosmetic: the task check keys off a successful apply, so the
 * founder's whole validation funnel stopped at a button that could never work,
 * with no way forward and nothing explaining why.
 *
 * The card still carries the items the founder just read and approved, and the
 * request is already scoped to their own project by tryProjectAccess. So the
 * honest move is to stage what they approved for real and let the normal apply
 * path run — recover, rather than 404 and block them.
 *
 * Deliberately narrow: apply only, validation items only, and every item must
 * carry a non-empty value. Anything else still 404s, because a silent recovery
 * of an unrecognised shape would hide a different bug.
 */

/** Cap: a genuine card is a handful of items; more means something is wrong. */
const MAX_ITEMS = 20;

export interface OrphanRecoveryInput {
  projectId: string;
  /** The unresolvable id the card sent — logged so the rate is measurable. */
  requestedId: string;
  transition: string;
  editedPayload: unknown;
}

interface ValidationItem {
  value?: unknown;
  [key: string]: unknown;
}

/** The items a validation card sends back, if this payload is really one. */
export function extractValidationItems(editedPayload: unknown): ValidationItem[] | null {
  if (!editedPayload || typeof editedPayload !== 'object') return null;
  const items = (editedPayload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) return null;
  const usable = items.filter(
    (it): it is ValidationItem =>
      !!it && typeof it === 'object'
      && typeof (it as ValidationItem).value === 'string'
      && ((it as ValidationItem).value as string).trim().length > 0,
  );
  // Partial garbage means we do not understand the payload — do not guess.
  return usable.length === items.length ? usable : null;
}

export async function recoverOrphanValidation(
  input: OrphanRecoveryInput,
): Promise<StagedAction | null> {
  if (input.transition !== 'apply') return null;
  const items = extractValidationItems(input.editedPayload);
  if (!items) return null;

  console.warn(
    `[actions] recovering orphan validation apply — the card carried an id with no row `
      + `(requested_id=${JSON.stringify(input.requestedId)}, project=${input.projectId}, `
      + `items=${items.length}). The Co-pilot emitted the card itself instead of calling `
      + `propose_validation; staging it for real so the founder is not blocked.`,
  );

  return createPendingAction({
    project_id: input.projectId,
    action_type: 'validation_proposal',
    title: 'Validation evidence (recovered)',
    rationale:
      `Recovered from a card whose pending_action_id (${String(input.requestedId).slice(0, 40)}) `
      + 'had no row. The founder approved these items on screen.',
    payload: { origin: 'recovered', items },
    estimated_impact: 'medium',
  });
}
