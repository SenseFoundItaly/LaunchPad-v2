import { NextRequest } from 'next/server';
import { run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

const STAGES = ['idea', 'mvp', 'pmf', 'growth', 'scale'];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();

  if (!body?.current_stage) {return error('current_stage is required');}
  if (!STAGES.includes(body.current_stage)) {
    return error(`Invalid stage. Must be one of: ${STAGES.join(', ')}`);
  }

  // Map stage to project current_step
  const stageToStep: Record<string, number> = {
    idea: 1,
    mvp: 2,
    pmf: 3,
    growth: 4,
    scale: 5,
  };

  await run(
    'UPDATE projects SET current_step = ?, updated_at = ? WHERE id = ?',
    stageToStep[body.current_stage],
    new Date().toISOString(),
    projectId,
  );

  return json({
    current_stage: body.current_stage,
    started_at: body.started_at || null,
  });
}
