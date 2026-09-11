import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const { planId } = await params;
  const plan = get('SELECT * FROM workflow_plans WHERE id = ?', planId);
  if (!plan) return error('Plan not found', 404);
  return json(plan);
}
