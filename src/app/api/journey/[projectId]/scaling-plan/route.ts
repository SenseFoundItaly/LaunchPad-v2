import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { SCALING_PLAN_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('scaling_plan', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading startup data...');
      const [ideaResult, scoreResult, metricsResult, loopsResult, msResult, roundResult, projectResult] =
        await Promise.all([
          supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle(),
          supabase.from('scores').select('*').eq('project_id', projectId).maybeSingle(),
          supabase.from('metrics').select('*').eq('project_id', projectId),
          supabase.from('growth_loops').select('*').eq('project_id', projectId),
          supabase.from('milestones').select('*').eq('project_id', projectId),
          supabase.from('fundraising_rounds').select('*').eq('project_id', projectId).maybeSingle(),
          supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
        ]);

      const project = projectResult.data;
      let currentStage = 'idea';
      if (project) {
        const step = project.current_step as number;
        if (step >= 5) currentStage = 'scale';
        else if (step >= 4) currentStage = 'growth';
        else if (step >= 3) currentStage = 'pmf';
        else if (step >= 2) currentStage = 'mvp';
      }

      const context = {
        idea_canvas: ideaResult.data,
        scores: scoreResult.data,
        metrics: metricsResult.data || [],
        growth_loops: loopsResult.data || [],
        current_stage: currentStage,
        milestones: msResult.data || [],
        fundraising: roundResult.data,
      };

      setProgress(task.task_id, 30, 'Analyzing growth trajectory...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SCALING_PLAN_PROMPT },
        { role: 'user', content: `Create a scaling plan for this startup:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 50, 'Building scaling plan...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
