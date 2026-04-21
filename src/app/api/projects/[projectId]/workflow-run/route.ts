import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

/**
 * GET /api/projects/{projectId}/workflow-run
 *
 * Returns the most-recently-updated workflow_plans row for the project,
 * plus its tool_executions as a flat log stream. Powers the /workflow
 * Pipeline design screen.
 *
 * Returns null plan + empty executions when the project has no workflow
 * activity yet — the page renders an empty state in that case.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const plans = query<{
    id: string;
    name: string;
    description: string | null;
    steps: string;
    status: string;
    current_step: number;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, name, description, steps, status, current_step, created_at, updated_at
     FROM workflow_plans
     WHERE project_id = ?
     ORDER BY updated_at DESC
     LIMIT 1`,
    projectId,
  );

  if (plans.length === 0) {
    return json({ plan: null, executions: [] });
  }

  const plan = plans[0];
  let steps: unknown[] = [];
  try {
    steps = JSON.parse(plan.steps);
  } catch { /* bad JSON, show empty DAG */ }

  const executions = query<{
    id: string;
    workflow_run_id: string | null;
    step_index: number | null;
    tool_id: string | null;
    status: string;
    input_params: string | null;
    output: string | null;
    error: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>(
    `SELECT id, workflow_run_id, step_index, tool_id, status, input_params, output, error, started_at, completed_at, created_at
     FROM tool_executions
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 50`,
    projectId,
  );

  return json({
    plan: {
      ...plan,
      steps,
    },
    executions,
  });
}
