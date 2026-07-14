import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { createPendingAction } from '@/lib/pending-actions';
import type { WorkflowStep } from '@/types/artifacts';

const EXECUTABLE_KINDS = new Set(['publish_landing_page', 'email_sequence', 'social_calendar', 'ad_pack', 'run_skill']);

/**
 * POST /api/projects/{projectId}/workflows/execute-step
 *   { workflow_title, step_index, step: WorkflowStep }
 *
 * Launch pipeline (W4): the workflow card's Execute button queues ONE step as
 * a `workflow_step` pending_action — the founder confirms in the Inbox, then
 * the dispatcher (src/lib/launch/workflow-executor.ts) runs the mapped
 * executor. Two-touch on purpose: the card click expresses intent, the Inbox
 * Apply is the auditable authorization every execution shares.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    workflow_title?: string; step_index?: number; step?: WorkflowStep;
  };
  const step = body.step;
  if (!step || typeof step.label !== 'string' || !step.label.trim()) {
    return error('step with a label is required', 400);
  }
  const kind = step.kind && EXECUTABLE_KINDS.has(step.kind) ? step.kind : null;
  if (!kind) return error(`step kind "${String(step.kind)}" is not executable`, 400);

  const pa = await createPendingAction({
    project_id: projectId,
    action_type: 'workflow_step',
    title: `Run step: ${step.label}`.slice(0, 200),
    rationale: `From workflow "${body.workflow_title ?? 'GTM plan'}" — Apply to run this step (${kind}). Everything it produces stays founder-gated too.`.slice(0, 400),
    payload: {
      step_kind: kind,
      label: step.label,
      skill_id: step.skill_id,
      params: step.params ?? {},
      workflow_title: body.workflow_title ?? null,
      step_index: body.step_index ?? null,
    },
    estimated_impact: 'medium',
  });
  return json({ pending_action_id: pa.id });
}
