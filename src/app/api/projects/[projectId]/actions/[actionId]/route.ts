import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import {
  getPendingAction,
  approvePendingAction,
  editPendingAction,
  rejectPendingAction,
  markActionSent,
  markActionFailed,
  InvalidTransitionError,
} from '@/lib/pending-actions';
import { executeApprovedAction } from '@/lib/action-executors';
import { recordEvent } from '@/lib/memory/events';
import { recordFact } from '@/lib/memory/facts';

/**
 * GET /api/projects/{projectId}/actions/{actionId}
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; actionId: string }> },
) {
  const { projectId, actionId } = await params;
  const action = await getPendingAction(actionId);
  if (!action) return error('Action not found', 404);
  if (action.project_id !== projectId) return error('Action does not belong to this project', 403);
  return json(action);
}

/**
 * POST /api/projects/{projectId}/actions/{actionId}
 * Body: { transition: 'approve' | 'edit' | 'reject' | 'mark_sent' | 'mark_failed',
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
      case 'approve': {
        // If the founder edited fields on the inline approval card before
        // hitting Approve (monitor schedule, budget cap, etc.), persist the
        // edits FIRST so effectivePayload() in the executor sees them.
        // Skipping this would silently drop "Save & approve" overrides.
        if (body.edited_payload && typeof body.edited_payload === 'object') {
          await editPendingAction(actionId, body.edited_payload);
        }

        // 1. Transition pending/edited → approved
        updated = await approvePendingAction(actionId);

        // 2. Dispatch to the type-specific handler. Structured handlers
        //    ("direct") write a row to a domain table and we chain straight
        //    to 'sent'. Click-to-send handlers return a URL and we stay at
        //    'approved' until the founder confirms the click via a
        //    follow-up mark_sent call. Outbox handlers (no URL, no direct
        //    write) we also chain to 'sent' since the founder's
        //    "approve" click IS the acknowledgment.
        const result = await executeApprovedAction(updated);
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
        // For 'click-to-send', status stays 'approved' — UI shows the URL
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
        updated = await rejectPendingAction(actionId, body.reason);
        // Preference learning: the agent proposed something the founder
        // didn't want. Record a low-confidence 'preference' fact so future
        // buildMemoryContext calls include "user rejected X" in the prompt,
        // steering the agent away from similar proposals. Non-fatal.
        try {
          const owner = (await query<{ owner_user_id: string | null }>(
            'SELECT owner_user_id FROM projects WHERE id = ?', projectId,
          ))[0];
          if (owner?.owner_user_id) {
            const reasonSuffix = body.reason ? `. Reason: ${String(body.reason).slice(0, 200)}` : '';
            const factText = `User rejected agent-proposed action "${existing.title}" (type: ${existing.action_type})${reasonSuffix}`;
            await recordFact({
              userId: owner.owner_user_id,
              projectId,
              fact: factText,
              kind: 'preference',
              sourceType: 'approval_inbox',
              sourceId: actionId,
              confidence: 0.6,
            });
            await recordEvent({
              userId: owner.owner_user_id,
              projectId,
              eventType: 'action_rejected',
              payload: {
                action_id: actionId,
                title: existing.title,
                action_type: existing.action_type,
                reason: body.reason ?? null,
              },
            });
          }
        } catch (err) {
          console.warn('[actions] preference-learning hook failed (non-fatal):', err);
        }
        break;
      }
      case 'mark_sent':
        updated = await markActionSent(actionId, body.result || {});
        break;
      case 'mark_failed':
        updated = await markActionFailed(actionId, body.error || 'Unknown error');
        break;
      default:
        return error(`Unknown transition: ${transition}. Must be one of: approve, edit, reject, mark_sent, mark_failed`);
    }
    return json(updated);
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return error(err.message, 409);
    }
    return error((err as Error).message, 500);
  }
}
