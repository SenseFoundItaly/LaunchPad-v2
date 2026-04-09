import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, error, unauthorized } from '@/lib/api-helpers';

const STAGES = ['idea', 'mvp', 'pmf', 'growth', 'scale'];

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json();

  if (!body?.current_stage) return error('current_stage is required');
  if (!STAGES.includes(body.current_stage)) {
    return error(`Invalid stage. Must be one of: ${STAGES.join(', ')}`);
  }

  const stageToStep: Record<string, number> = {
    idea: 1,
    mvp: 2,
    pmf: 3,
    growth: 4,
    scale: 5,
  };

  const supabase = await createServerSupabase();
  await supabase
    .from('projects')
    .update({ current_step: stageToStep[body.current_stage], updated_at: new Date().toISOString() })
    .eq('id', projectId);

  return json({
    current_stage: body.current_stage,
    started_at: body.started_at || null,
  });
}
