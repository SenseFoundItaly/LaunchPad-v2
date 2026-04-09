import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { approveAndResume } from '@/lib/workflows/executor';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;

  try {
    // Run in background
    approveAndResume(planId).catch((err) => {
      console.error(`Workflow resume failed for ${planId}:`, err);
    });
    return json({ approved: true, plan_id: planId });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Failed to approve', 500);
  }
}
