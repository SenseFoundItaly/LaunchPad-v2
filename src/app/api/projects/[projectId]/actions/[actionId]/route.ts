import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import {
  getPendingAction,
  approvePendingAction,
  editPendingAction,
  rejectPendingAction,
  markActionSent,
  markActionFailed,
  InvalidTransitionError,
} from '@/lib/pending-actions';

/**
 * GET /api/projects/{projectId}/actions/{actionId}
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; actionId: string }> },
) {
  const { projectId, actionId } = await params;
  const action = getPendingAction(actionId);
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

  const existing = getPendingAction(actionId);
  if (!existing) return error('Action not found', 404);
  if (existing.project_id !== projectId) {
    return error('Action does not belong to this project', 403);
  }

  try {
    let updated;
    switch (transition) {
      case 'approve':
        updated = approvePendingAction(actionId);
        break;
      case 'edit':
        if (!body.edited_payload || typeof body.edited_payload !== 'object') {
          return error('edited_payload must be an object');
        }
        updated = editPendingAction(actionId, body.edited_payload);
        break;
      case 'reject':
        updated = rejectPendingAction(actionId, body.reason);
        break;
      case 'mark_sent':
        updated = markActionSent(actionId, body.result || {});
        break;
      case 'mark_failed':
        updated = markActionFailed(actionId, body.error || 'Unknown error');
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
