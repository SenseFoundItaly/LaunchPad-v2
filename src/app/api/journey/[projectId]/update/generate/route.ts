import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { UPDATE_GENERATE_PROMPT } from '@/lib/llm/prompts';
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

  const task = createTask('generate_update', projectId);

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

      setProgress(task.task_id, 20, 'Loading context...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();
      const { data: project } = await supabase.from('projects').select('*').eq('id', projectId).maybeSingle();
      const { data: milestones } = await supabase.from('milestones').select('*').eq('project_id', projectId);
      const { data: prevUpdates } = await supabase
        .from('startup_updates')
        .select('*')
        .eq('project_id', projectId)
        .order('date', { ascending: false })
        .limit(3);

      let currentStage = 'idea';
      if (project) {
        const step = project.current_step as number;
        if (step >= 5) currentStage = 'scale';
        else if (step >= 4) currentStage = 'growth';
        else if (step >= 3) currentStage = 'pmf';
        else if (step >= 2) currentStage = 'mvp';
      }

      const context = {
        idea_canvas: ideaCanvas,
        metrics: metricsWithEntries,
        current_stage: currentStage,
        milestones: milestones || [],
        previous_updates: prevUpdates || [],
      };

      setProgress(task.task_id, 40, 'Generating update...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: UPDATE_GENERATE_PROMPT },
        { role: 'user', content: `Generate a founder update from this data:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Drafting update...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 80, 'Saving update...');
      const { data: savedUpdate } = await supabase
        .from('startup_updates')
        .insert({
          project_id: projectId,
          period: (r.period as string) || '',
          metrics_snapshot: r.metrics_snapshot || [],
          highlights: r.highlights || [],
          challenges: r.challenges || [],
          asks: r.asks || [],
          morale: r.morale || null,
          generated_summary: r.lesson_learned || null,
          date: new Date().toISOString().split('T')[0],
        })
        .select()
        .single();

      const update = { ...(savedUpdate || {}), generated: true, ...r };
      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, update as Record<string, unknown>);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
