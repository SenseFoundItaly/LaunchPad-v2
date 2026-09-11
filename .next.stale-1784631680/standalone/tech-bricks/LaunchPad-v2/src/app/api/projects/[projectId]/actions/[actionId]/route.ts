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

/**
 * GET /api/projects/{projectId}/actions/{actionId}
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; actionId: string }> },
) {
  const { projectId, actionId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const action = await getPendingAction(actionId);
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

  const existing = await getPendingAction(actionId);
  if (!existing) return error('Action not found', 404);
  if (existing.project_id !== projectId) {
    return error('Action does not belong to this project', 403);
  }

  try {
    let updated;
    switch (transition) {
      case 'apply': {
        // Idempotent guard: an inline card re-rendered after a refresh starts
        // in its 'active' (clickable) state with no knowledge that the proposal
        // already ran. Re-firing Apply on a resolved proposal would hit
        // editPendingAction/applyPendingAction, and the state machine has no
        // path out of sent/rejected (or applied→edited) — so it threw
        // "Invalid transition: sent -> edited" at the founder. Treat an
        // already-resolved proposal as a no-op success instead.
        if (existing.status === 'sent' || existing.status === 'applied' || existing.status === 'rejected') {
          return json({ ...existing, deliverable: null, already_resolved: true });
        }

        // If the founder edited fields on the inline review card before
        // hitting Apply (monitor schedule, budget cap, etc.), persist the
        // edits FIRST so effectivePayload() in the executor sees them.
        // Skipping this would silently drop "Save & apply" overrides.
        if (body.edited_payload && typeof body.edited_payload === 'object') {
          await editPendingAction(actionId, body.edited_payload);
        }

        // 1. Transition pending/edited → applied
        updated = await applyPendingAction(actionId);

        // 2. Dispatch to the type-specific handler. Structured handlers
        //    ("direct") write a row to a domain table and we chain straight
        //    to 'sent'. Click-to-send handlers return a URL and we stay at
        //    'applied' until the founder confirms the click via a
        //    follow-up mark_sent call. Outbox handlers (no URL, no direct
        //    write) we also chain to 'sent' since the founder's
        //    "apply" click IS the acknowledgment.
        const result = await executeAppliedAction(updated);
        if (!result.ok) {
          updated = await markActionFailed(actionId, result.error || 'Handler returned not-ok');
          return json({ ...updated, deliverable: null, execution_error: result.error });
        }

        const mode = result.deliverable?.mode;
        if (mode === 'direct' || mode === 'outbox') {
          updated = await markActionSent(actionId, {
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
        updated = await editPendingAction(actionId, body.edited_payload);
        break;
      case 'reject': {
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
        updated = await markActionSent(actionId, body.result || {});
        break;
      case 'mark_failed':
        updated = await markActionFailed(actionId, body.error || 'Unknown error');
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
