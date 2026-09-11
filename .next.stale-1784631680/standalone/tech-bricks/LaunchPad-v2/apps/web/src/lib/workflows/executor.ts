import { run, get } from '@/lib/db';
import { executeTool } from '@/lib/tools/registry';
import type { WorkflowStep } from '@/lib/tools/types';

interface PlanRow {
  id: string;
  project_id: string;
  steps: string;
  status: string;
  current_step: number;
}

interface StepExecution {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'awaiting-approval';
  output?: Record<string, unknown>;
  error?: string;
}

export async function executeWorkflowPlan(planId: string): Promise<void> {
  const plan = get<PlanRow>('SELECT * FROM workflow_plans WHERE id = ?', planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);

  const steps: WorkflowStep[] = JSON.parse(plan.steps);
  const results = new Map<string, Record<string, unknown>>();

  run('UPDATE workflow_plans SET status = \'running\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', planId);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    run('UPDATE workflow_plans SET current_step = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', i, planId);

    // Check if plan was paused (user needs to approve)
    if (step.requires_approval) {
      run('UPDATE workflow_plans SET status = \'paused\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', planId);
      return; // Exit — will be resumed when user approves
    }

    // Check dependencies
    for (const depId of step.depends_on || []) {
      if (!results.has(depId)) {
        run('UPDATE workflow_plans SET status = \'failed\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', planId);
        throw new Error(`Dependency not met: step ${depId}`);
      }
    }

    // Apply output mappings from previous steps
    const resolvedParams = { ...step.params };
    if (step.output_mapping) {
      for (const [outputField, paramName] of Object.entries(step.output_mapping)) {
        // Find the output value from any completed step
        for (const [, result] of results) {
          if (outputField in result) {
            resolvedParams[paramName] = result[outputField];
          }
        }
      }
    }

    // Execute the step
    const result = await executeTool(step.tool_name, resolvedParams, {
      projectId: plan.project_id,
      workflowRunId: planId,
    });

    if (!result.success) {
      run('UPDATE workflow_plans SET status = \'failed\', updated_at = CURRENT_TIMESTAMP WHERE id = ?', planId);
      throw new Error(`Step ${step.id} failed: ${result.error}`);
    }

    results.set(step.id, { ...result.output, draftId: result.draftId });
  }

  run('UPDATE workflow_plans SET status = \'completed\', current_step = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', steps.length, planId);
}

export async function approveAndResume(planId: string): Promise<void> {
  const plan = get<PlanRow>('SELECT * FROM workflow_plans WHERE id = ?', planId);
  if (!plan) throw new Error(`Plan not found: ${planId}`);
  if (plan.status !== 'paused') throw new Error(`Plan is not paused (status: ${plan.status})`);

  // Mark the current step as no longer requiring approval and resume
  const steps: WorkflowStep[] = JSON.parse(plan.steps);
  if (plan.current_step < steps.length) {
    steps[plan.current_step].requires_approval = false;
    run(
      'UPDATE workflow_plans SET steps = ?, status = \'running\', updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      JSON.stringify(steps),
      planId,
    );
  }

  // Resume execution
  await executeWorkflowPlan(planId);
}
