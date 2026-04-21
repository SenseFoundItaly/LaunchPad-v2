/**
 * Workflow capture — when the agent emits a :::artifact{type="workflow-card"}
 * during a chat turn, persist it as a workflow_plan + one pending_actions row
 * per step. This closes the loop between "agent proposed X during chat" and
 * "X shows up as an actionable task in the approval inbox + workflow view".
 *
 * Called from src/app/api/chat/route.ts flush hook alongside fact-artifact
 * extraction. Non-fatal on failure.
 */

import crypto from 'crypto';
import { run } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import { recordEvent } from '@/lib/memory/events';
import { recordFact } from '@/lib/memory/facts';
import type { WorkflowCard } from '@/types/artifacts';

export interface CapturedWorkflow {
  plan_id: string;
  step_count: number;
  pending_action_ids: string[];
}

/**
 * Persist a workflow-card artifact produced by the chat agent.
 *
 * Side effects:
 *   1. INSERT into workflow_plans (status='proposed', steps JSON)
 *   2. For each step, INSERT a pending_actions row with
 *      action_type='workflow_step' so the founder sees it in the approval
 *      inbox (/project/[id]/actions).
 *   3. recordFact(kind='decision') — the agent proposing a workflow is a
 *      meaningful decision the founder might revisit
 *   4. recordEvent(event_type='workflow_proposed')
 *
 * Returns the created plan_id + pending_action_ids so the caller can surface
 * them in logs / the stream done frame if desired.
 */
export function captureWorkflow(input: {
  userId: string;
  projectId: string;
  artifact: WorkflowCard;
  chatTurnPreview?: string;
}): CapturedWorkflow | null {
  const { userId, projectId, artifact } = input;
  if (!artifact.title || !Array.isArray(artifact.steps) || artifact.steps.length === 0) {
    return null;
  }

  const planId = crypto.randomUUID();

  try {
    run(
      `INSERT INTO workflow_plans (id, project_id, name, description, steps, status, current_step)
       VALUES (?, ?, ?, ?, ?, 'proposed', 0)`,
      planId,
      projectId,
      artifact.title,
      artifact.description || '',
      JSON.stringify(artifact.steps),
    );
  } catch (err) {
    console.warn('[workflow-capture] workflow_plans INSERT failed:', (err as Error).message);
    return null;
  }

  // One pending_action per step so the founder can approve/edit/reject each
  // individually in the existing approval inbox. Rationale + payload carry
  // enough context for the UI to render without a join back to workflow_plans.
  const actionIds: string[] = [];
  artifact.steps.forEach((stepText, idx) => {
    try {
      const created = createPendingAction({
        project_id: projectId,
        action_type: 'workflow_step',
        title: `Step ${idx + 1} of "${artifact.title}": ${stepText.slice(0, 80)}`,
        rationale: `Part of the "${artifact.title}" workflow the agent proposed in chat. Category: ${artifact.category ?? 'general'}. Priority: ${artifact.priority ?? 'medium'}.`,
        payload: {
          workflow_plan_id: planId,
          workflow_title: artifact.title,
          step_index: idx,
          step_text: stepText,
          category: artifact.category,
          priority: artifact.priority,
        },
        estimated_impact: artifact.priority === 'high' ? 'high' : 'medium',
      });
      actionIds.push(created.id);
    } catch (err) {
      console.warn(`[workflow-capture] step ${idx} pending_action failed:`, (err as Error).message);
    }
  });

  // Memory: both a fact (durable, "the agent proposed X") and an event
  // (timeline). The fact has higher confidence because it's a concrete
  // proposal, not a guess. Fires outside the try so a failed persistence
  // above still traces.
  try {
    recordFact({
      userId,
      projectId,
      fact: `Agent proposed workflow "${artifact.title}" (${artifact.steps.length} steps, category: ${artifact.category ?? 'general'})`,
      kind: 'decision',
      sourceType: 'chat',
      sourceId: planId,
      confidence: 0.85,
    });
    recordEvent({
      userId,
      projectId,
      eventType: 'workflow_proposed',
      payload: {
        plan_id: planId,
        title: artifact.title,
        category: artifact.category,
        priority: artifact.priority,
        step_count: artifact.steps.length,
        pending_action_ids: actionIds,
      },
    });
  } catch (err) {
    console.warn('[workflow-capture] memory write failed:', (err as Error).message);
  }

  return {
    plan_id: planId,
    step_count: artifact.steps.length,
    pending_action_ids: actionIds,
  };
}
