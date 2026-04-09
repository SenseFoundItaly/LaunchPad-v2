import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { SCORING_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  try { await requireUser(); } catch { return unauthorized(); }

  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) return error('project_id required');

  const task = createTask('scoring', projectId);

  // Run in background
  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading idea canvas...');
      const { data: ideaCanvas } = await supabase
        .from('idea_canvas')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();

      if (!ideaCanvas) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      setProgress(task.task_id, 30, 'Analyzing startup idea...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SCORING_PROMPT },
        { role: 'user', content: `Score this startup idea:\n\n${JSON.stringify(ideaCanvas, null, 2)}` },
      ];

      setProgress(task.task_id, 50, 'Running multi-dimensional scoring...');
      const result = await chatJSON(messages, provider);

      setProgress(task.task_id, 90, 'Saving results...');
      await supabase
        .from('scores')
        .upsert(
          {
            project_id: projectId,
            overall_score: (result).overall_score,
            dimensions: (result).dimensions,
            benchmark: (result).benchmark_comparison,
            recommendation: (result).top_recommendation,
            scored_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' },
        );

      // Update project status
      await supabase
        .from('projects')
        .update({
          status: 'scored',
          current_step: 2,
          updated_at: new Date().toISOString(),
        })
        .eq('id', projectId);

      completeTask(task.task_id, result);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
