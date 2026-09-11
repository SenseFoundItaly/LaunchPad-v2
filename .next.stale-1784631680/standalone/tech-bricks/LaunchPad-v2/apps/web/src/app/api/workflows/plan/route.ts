import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { planWorkflow } from '@/lib/workflows/planner';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { description, project_id, provider } = body;

  if (!description) return error('description is required');
  if (!project_id) return error('project_id is required');

  const plan = await planWorkflow(description, project_id, provider);

  const planId = `wfp_${uuid().slice(0, 12)}`;
  run(
    `INSERT INTO workflow_plans (id, project_id, name, description, steps, status, current_step, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'planned', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    planId,
    project_id,
    plan.name,
    plan.description,
    JSON.stringify(plan.steps),
  );

  return json({ plan_id: planId, ...plan });
}
