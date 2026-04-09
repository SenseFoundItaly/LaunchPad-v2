import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { ITERATE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, unauthorized } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string }> },
) {
  try { await requireUser(); } catch { return unauthorized(); }
  const { projectId, loopId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('growth_iterate', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading growth loop data...');
      const { data: loop } = await supabase.from('growth_loops').select('*').eq('id', loopId).maybeSingle();
      if (!loop) {
        failTask(task.task_id, 'Growth loop not found.');
        return;
      }

      const { data: iterations } = await supabase
        .from('growth_iterations')
        .select('*')
        .eq('loop_id', loopId)
        .order('created_at', { ascending: true });

      setProgress(task.task_id, 20, 'Loading startup context...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();
      const { data: scores } = await supabase.from('scores').select('*').eq('project_id', projectId).maybeSingle();
      const { data: metrics } = await supabase.from('metrics').select('*').eq('project_id', projectId);

      const loopWithIter = { ...loop, iterations: iterations || [] };

      const context = {
        idea_canvas: ideaCanvas,
        scores,
        metrics: metrics || [],
        loop: loopWithIter,
      };

      setProgress(task.task_id, 40, 'Analyzing prior iterations...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: ITERATE_PROMPT },
        { role: 'user', content: `Generate the next optimization iteration:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating next experiment...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 80, 'Saving iteration...');
      const { data: iteration } = await supabase
        .from('growth_iterations')
        .insert({
          loop_id: loopId,
          hypothesis: r.hypothesis,
          proposed_changes: r.proposed_changes,
          status: 'proposed',
        })
        .select()
        .single();

      const iterWithLLM = { ...(iteration || {}), ...r };

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, iterWithLLM as Record<string, unknown>);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
