import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { SYNTHESIZE_PROMPT } from '@/lib/llm/prompts';
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

  const task = createTask('growth_synthesize', projectId);

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

      const loopWithIter = { ...loop, iterations: iterations || [] };

      setProgress(task.task_id, 30, 'Preparing synthesis context...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SYNTHESIZE_PROMPT },
        { role: 'user', content: `Synthesize learnings from this optimization loop:\n\n${JSON.stringify(loopWithIter, null, 2)}` },
      ];

      setProgress(task.task_id, 50, 'Synthesizing learnings...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 80, 'Saving synthesis...');
      await supabase
        .from('growth_loops')
        .update({ accumulated_learnings: (r.accumulated_learnings as string) || '' })
        .eq('id', loopId);

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
