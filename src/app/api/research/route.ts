import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { RESEARCH_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  try { await requireUser(); } catch { return unauthorized(); }

  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) return error('project_id required');

  const task = createTask('research', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading idea canvas...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();
      if (!ideaCanvas) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      setProgress(task.task_id, 30, 'Researching market size...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: RESEARCH_PROMPT },
        { role: 'user', content: `Research this startup idea:\n\n${JSON.stringify(ideaCanvas, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Analyzing competitors and trends...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Saving results...');
      await supabase
        .from('research')
        .upsert(
          {
            project_id: projectId,
            market_size: r.market_size,
            competitors: r.competitors,
            trends: r.trends,
            case_studies: r.case_studies,
            key_insights: r.key_insights,
            researched_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' },
        );

      await supabase
        .from('projects')
        .update({ status: 'researched', current_step: 3, updated_at: new Date().toISOString() })
        .eq('id', projectId);

      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
