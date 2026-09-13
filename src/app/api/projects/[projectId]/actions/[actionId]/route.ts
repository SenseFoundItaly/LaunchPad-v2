import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import {
  getPendingAction,
  applyPendingAction,
  editPendingAction,
  markActionSent,
  markActionFailed,
  InvalidTransitionError,
} from '@/lib/pending-actions';
import { executeAppliedAction } from '@/lib/action-executors';
import { rejectActionWithSideEffects } from '@/lib/reject-action';
import { recoverOrphanValidation, findRecoveredValidation, recoveredValidationEdits } from '@/lib/recover-orphan-validation';

/**
 * GET /api/projects/{projectId}/actions/{actionId}
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; actionId: string }> },
) {
  const { projectId, actionId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const action = await getPendingAction(actionId) ?? await findRecoveredValidation({
    projectId, requestedId: actionId, artifactId: request.nextUrl.searchParams.get('artifact_id'),
  });
  if (!action) return error('Action not found', 404);
  if (action.project_id !== projectId) return error('Action does not belong to this project', 403);
  return json(action);
}

/**
 * POST /api/projects/{projectId}/actions/{actionId}
 * Body: { transition: 'apply' | 'edit' | 'reject' | 'mark_sent' | 'mark_failed',
 *         edited_payload?, reason?, result?, error? }
 *
 * This is a single endpoint for all state-machine transitions. Using a
 * transition verb instead of separate routes keeps the state machine owner
 * (pending-actions.ts) as the single source of truth for legality.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; actionId: string }> },
) {
  const { projectId, actionId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  const transition = body?.transition as string;

  let existing = await getPendingAction(actionId);
  if (!existing) {
    // The Co-pilot sometimes hand-writes a validation card and fills its
    // pending_action_id with a placeholder (measured on prod 2026-09-08: the
    // literal string "pending"), so the row never existed. That 404 blocked the
    // founder's whole funnel, because the task check keys off a successful
    // apply. The card still carries the items they approved — stage them for
    // real. See recover-orphan-validation.ts for why this is deliberately narrow.
    existing = await recoverOrphanValidation({
      projectId,
      requestedId: actionId,
      transition,
      editedPayload: body?.edited_payload,
      artifactId: body?.artifact_id,
    });
  }
  if (!existing) return error('Action not found', 404);
  if (existing.project_id !== projectId) {
    return error('Action does not belong to this project', 403);
  }

  // Every transition below must address the row we actually resolved. On the
  // recovery path that is a NEWLY staged row, whose id is not the one in the
  // URL — using actionId there would fail on the row we just created.
  const rowId = existing.id;

  try {
    let updated;
    switch (transition) {
      case 'apply': {
        if (existing.status === 'rejected') return error('This proposal was skipped.', 409);
        if (existing.status === 'applied' && existing.action_type === 'validation_proposal') {
          return error('This approval is already being processed. Please wait before retrying.', 409);
        }
        if (existing.status === 'sent' || existing.status === 'applied') {
          return json({ ...existing, deliverable: null, already_resolved: true });
        }

        let edits = body.edited_payload && typeof body.edited_payload === 'object'
          ? body.edited_payload as Record<string, unknown> : undefined;
        if (existing.payload.origin === 'recovered') {
          const checked = recoveredValidationEdits(existing.payload, edits ?? existing.edited_payload ?? existing.payload);
          if (!checked) return error('Edited items do not match the original validation card.', 400);
          edits = checked;
        }
        // Store edits and claim execution atomically. Separate edit/apply calls
        // allowed concurrent approvals to overwrite the winning request's text.
        updated = await applyPendingAction(rowId, edits);

        // 2. Dispatch to the type-specific handler. Structured handlers
        //    ("direct") write a row to a domain table and we chain straight
        //    to 'sent'. Click-to-send handlers return a URL and we stay at
        //    'applied' until the founder confirms the click via a
        //    follow-up mark_sent call. Outbox handlers (no URL, no direct
        //    write) we also chain to 'sent' since the founder's
        //    "apply" click IS the acknowledgment.
        const result = await executeAppliedAction(updated);
        if (!result.ok) {
          updated = await markActionFailed(rowId, result.error || 'Handler returned not-ok');
          // Fail the REQUEST, not just the row: this used to return 200
          // {success:true} with an execution_error field no client ever read,
          // so every Apply card rendered its success checkmark over a write
          // that never happened. The action row is already marked 'failed'
          // (re-armed for retry after reload); the non-2xx makes the card
          // show its error state instead of a false ✓.
          return error(result.error || 'Applying the action failed', 422);
        }

        const mode = result.deliverable?.mode;
        if (mode === 'direct' || mode === 'outbox') {
          updated = await markActionSent(rowId, {
            target: mode,
            external_id: result.deliverable?.created_row_id,
            response: result.deliverable?.narrative,
          });
        }
        // For 'click-to-send', status stays 'applied' — UI shows the URL
        // and a "Mark as sent" button the founder hits after clicking.
        return json({ ...updated, deliverable: result.deliverable });
      }
      case 'edit':
        if (!body.edited_payload || typeof body.edited_payload !== 'object') {
          return error('edited_payload must be an object');
        }
        updated = await editPendingAction(rowId, body.edited_payload);
        break;
      case 'reject': {
        if (existing.status === 'rejected') return json({ ...existing, already_resolved: true });
        // All rejection side-effects (source-row propagation, the Loop-1
        // founder-first release, preference learning) live in ONE shared
        // helper so this route and the chat agent's dismiss_pending_actions
        // tool cannot drift — the tool once skipped the Loop-1 release and
        // re-opened the §4 dead-end.
        updated = await rejectActionWithSideEffects(
          existing,
          typeof body.reason === 'string' ? body.reason : undefined,
        );
        break;
      }
      case 'mark_sent':
        updated = await markActionSent(rowId, body.result || {});
        break;
      case 'mark_failed':
        updated = await markActionFailed(rowId, body.error || 'Unknown error');
        break;
      default:
        return error(`Unknown transition: ${transition}. Must be one of: apply, edit, reject, mark_sent, mark_failed`);
    }
    return json(updated);
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return error(err.message, 409);
    }
    return error((err as Error).message, 500);
  }
}
