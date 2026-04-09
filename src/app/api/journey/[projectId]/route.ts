import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { json, unauthorized } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;

  const supabase = await createServerSupabase();

  const [milestonesResult, updatesResult, projectResult] = await Promise.all([
    supabase
      .from('milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('week', { ascending: true }),
    supabase
      .from('startup_updates')
      .select('*')
      .eq('project_id', projectId)
      .order('date', { ascending: false }),
    supabase
      .from('projects')
      .select('*')
      .eq('id', projectId)
      .maybeSingle(),
  ]);

  const project = projectResult.data;

  // Infer stage from project status
  let currentStage = 'idea';
  if (project) {
    const step = project.current_step as number;
    if (step >= 5) currentStage = 'growth';
    else if (step >= 4) currentStage = 'pmf';
    else if (step >= 3) currentStage = 'mvp';
  }

  return json({
    stage: {
      current_stage: currentStage,
      started_at: project?.created_at || null,
    },
    milestones: milestonesResult.data || [],
    updates: updatesResult.data || [],
    scaling_plan: null,
  });
}
