import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { INVESTOR_UPDATE_PROMPT } from '@/lib/llm/prompts';
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

  const task = createTask('investor_update', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading metrics...');
      const { data: metricsRows } = await supabase.from('metrics').select('*').eq('project_id', projectId);
      const metricsWithEntries = await Promise.all(
        (metricsRows || []).map(async (m: Record<string, unknown>) => {
          const { data: entries } = await supabase
            .from('metric_entries')
            .select('*')
            .eq('metric_id', m.id)
            .order('date', { ascending: true });
          return { ...m, entries: entries || [] };
        }),
      );

      const { data: burnRate } = await supabase.from('burn_rate').select('*').eq('project_id', projectId).maybeSingle();

      setProgress(task.task_id, 20, 'Loading startup context...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();
      const { data: round } = await supabase.from('fundraising_rounds').select('*').eq('project_id', projectId).maybeSingle();
      const { data: investors, count } = await supabase
        .from('investors')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId);

      const context = {
        idea_canvas: ideaCanvas,
        metrics: metricsWithEntries,
        burn_rate: burnRate,
        round,
        investor_count: count || 0,
      };

      setProgress(task.task_id, 40, 'Generating investor update...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: INVESTOR_UPDATE_PROMPT },
        { role: 'user', content: `Generate an investor update from this data:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Drafting update email...');
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
