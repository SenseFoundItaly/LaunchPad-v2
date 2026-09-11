import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { executeWorkflowPlan } from '@/lib/workflows/executor';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;

  // Run execution in background (non-blocking)
  executeWorkflowPlan(planId).catch((err) => {
    console.error(`Workflow execution failed for ${planId}:`, err);
  });

  return json({ started: true, plan_id: planId });
}
