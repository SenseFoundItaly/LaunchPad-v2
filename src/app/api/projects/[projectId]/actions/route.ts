import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import {
  createPendingAction,
  inboxSummary,
  listPendingActions,
  type CreatePendingActionInput,
} from '@/lib/pending-actions';
import type { PendingActionStatus, PendingActionType } from '@/types';

const VALID_STATUS: PendingActionStatus[] = [
  'pending', 'edited', 'approved', 'rejected', 'sent', 'failed',
];

const VALID_TYPES: PendingActionType[] = [
  'draft_email', 'draft_linkedin_post', 'draft_linkedin_dm',
  'proposed_hypothesis', 'proposed_interview_question', 'proposed_landing_copy',
  'proposed_investor_followup', 'proposed_graph_update',
  'task',
];

/**
 * GET /api/projects/{projectId}/actions?status=pending,edited&limit=50
 * Lists pending actions in the approval inbox.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const limitParam = url.searchParams.get('limit');

  let status: PendingActionStatus[] | undefined;
  if (statusParam) {
    status = statusParam.split(',')
      .map(s => s.trim())
      .filter((s): s is PendingActionStatus => VALID_STATUS.includes(s as PendingActionStatus));
    if (status.length === 0) return error('Invalid status filter');
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  if (Number.isNaN(limit)) return error('Invalid limit');

  const actions = listPendingActions({ project_id: projectId, status, limit });
  const summary = inboxSummary(projectId);
  return json({ actions, summary });
}

/**
 * POST /api/projects/{projectId}/actions
 * Manually create a pending action. Most actions are created by the monitor
 * runner, but founders (and skills) can queue their own drafts here too.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json() as Partial<CreatePendingActionInput>;

  if (!body?.action_type || !VALID_TYPES.includes(body.action_type)) {
    return error(`Invalid or missing action_type. Must be one of: ${VALID_TYPES.join(', ')}`);
  }
  if (!body.title || typeof body.title !== 'string') {
    return error('title is required');
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return error('payload must be an object');
  }

  const action = createPendingAction({
    project_id: projectId,
    action_type: body.action_type,
    title: body.title,
    payload: body.payload,
    rationale: body.rationale,
    estimated_impact: body.estimated_impact,
    monitor_run_id: body.monitor_run_id,
    ecosystem_alert_id: body.ecosystem_alert_id,
    execution_target: body.execution_target,
  });
  return json(action, 201);
}
