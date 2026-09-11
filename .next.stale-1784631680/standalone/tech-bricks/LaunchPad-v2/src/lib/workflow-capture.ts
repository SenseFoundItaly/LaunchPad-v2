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
import { recordEvent } from '@/lib/memory/events';
import { recordFact } from '@/lib/memory/facts';
import type { WorkflowCard } from '@/types/artifacts';

export interface CapturedWorkflow {
  plan_id: string;
  step_count: number;
}

/**
 * Persist a workflow-card artifact produced by the chat agent.
 *
 * Side effects:
 *   1. INSERT into workflow_plans (status='proposed', steps JSON)
 *   2. recordFact(kind='decision') — the agent proposing a workflow is a
 *      meaningful decision the founder might revisit
 *   3. recordEvent(event_type='workflow_proposed')
 *
 * NOTE: We used to also fan each step out into a pending_actions row so the
 * Inbox listed every step individually. That created a graveyard — Apply on
 * workflow_step was a no-op (src/lib/action-executors.ts:702) so the clicks
 * bought no downstream effect. The workflow-card artifact already renders in
 * the chat artifact column with its own progress UI; the workflow_plans row
 * holds the steps for any dedicated workflow surface to read from. So the
 * fan-out is dropped — Inbox stays clean for items that actually require a
 * yes/no decision.
 */
export async function captureWorkflow(input: {
  userId: string;
  projectId: string;
  artifact: WorkflowCard;
  chatTurnPreview?: string;
}): Promise<CapturedWorkflow | null> {
  const { userId, projectId, artifact } = input;
  if (!artifact.title || !Array.isArray(artifact.steps) || artifact.steps.length === 0) {
    return null;
  }

  const planId = crypto.randomUUID();

  // postgres.js + `unsafe()` auto-serializes JS arrays/objects to JSONB.
  // Pre-stringifying makes postgres store a JSONB *string* value (double-
  // encoded). Pass raw — same fix shipped in pending-actions.ts:115-118.
  const sourcesValue =
    Array.isArray(artifact.sources) && artifact.sources.length > 0
      ? artifact.sources
      : null;

  try {
    await run(
      `INSERT INTO workflow_plans (id, project_id, name, description, steps, status, current_step, sources)
       VALUES (?, ?, ?, ?, ?, 'proposed', 0, ?)`,
      planId,
      projectId,
      artifact.title,
      artifact.description || '',
      artifact.steps,
      sourcesValue,
    );
  } catch (err) {
    console.warn('[workflow-capture] workflow_plans INSERT failed:', (err as Error).message);
    return null;
  }

  // Memory: both a fact (durable, "the agent proposed X") and an event
  // (timeline). The fact has higher confidence because it's a concrete
  // proposal, not a guess. Fires outside the try so a failed persistence
  // above still traces.
  try {
    // sourceType 'workflow', NOT 'chat': this is an agent-authored trace with
    // no founder action behind it, and countMemoryFactsMatching excludes
    // 'workflow' from the journey keyword counter — an applied 'chat' fact
    // titled "TAM/SAM/SOM market sizing plan" greened market_size with zero
    // founder interaction (2026-07-10 gap audit H4).
    await recordFact({
      userId,
      projectId,
      fact: `Agent proposed workflow "${artifact.title}" (${artifact.steps.length} steps, category: ${artifact.category ?? 'general'})`,
      kind: 'decision',
      sourceType: 'workflow',
      sourceId: planId,
      confidence: 0.85,
    });
    await recordEvent({
      userId,
      projectId,
      eventType: 'workflow_proposed',
      payload: {
        plan_id: planId,
        title: artifact.title,
        category: artifact.category,
        priority: artifact.priority,
        step_count: artifact.steps.length,
      },
    });
  } catch (err) {
    console.warn('[workflow-capture] memory write failed:', (err as Error).message);
  }

  return {
    plan_id: planId,
    step_count: artifact.steps.length,
  };
}
