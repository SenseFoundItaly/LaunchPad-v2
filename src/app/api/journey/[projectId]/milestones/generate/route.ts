import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { MILESTONES_PROMPT } from '@/lib/llm/prompts';
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

  const task = createTask('generate_milestones', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading journey data...');
      const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();

      let currentStage = 'idea';
      if (project) {
        const step = project.current_step as number;
        if (step >= 5) currentStage = 'scale';
        else if (step >= 4) currentStage = 'growth';
        else if (step >= 3) currentStage = 'pmf';
        else if (step >= 2) currentStage = 'mvp';
      }

      setProgress(task.task_id, 20, 'Loading startup context...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();
      const { data: scores } = await supabase.from('scores').select('*').eq('project_id', projectId).maybeSingle();

      const context = {
        current_stage: currentStage,
        idea_canvas: ideaCanvas,
        scores,
      };

      setProgress(task.task_id, 40, 'Generating milestones...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: MILESTONES_PROMPT },
        { role: 'user', content: `Generate milestones for this startup:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Processing milestones...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 80, 'Saving milestones...');
      // Clear existing milestones for this project
      await supabase.from('milestones').delete().eq('project_id', projectId);

      const milestones = (r.milestones as Record<string, unknown>[]) || [];
      if (milestones.length > 0) {
        const rows = milestones.map((ms, i) => ({
          project_id: projectId,
          week: ms.estimated_weeks || i + 1,
          phase: ms.category || currentStage,
          title: ms.title,
          description: ms.description || '',
          status: 'upcoming',
          linked_feature: ms.linked_feature || null,
        }));
        await supabase.from('milestones').insert(rows);
      }

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
