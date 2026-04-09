import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { ANALYZE_PROMPT } from '@/lib/llm/prompts';
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

  const task = createTask('dashboard_analyze', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading metrics data...');
      const { data: metrics } = await supabase.from('metrics').select('*').eq('project_id', projectId);
      const metricsWithEntries = await Promise.all(
        (metrics || []).map(async (m: Record<string, unknown>) => {
          const { data: entries } = await supabase
            .from('metric_entries')
            .select('*')
            .eq('metric_id', m.id)
            .order('date', { ascending: true });
          return { ...m, entries: entries || [] };
        }),
      );

      const { data: burnRate } = await supabase.from('burn_rate').select('*').eq('project_id', projectId).maybeSingle();

      setProgress(task.task_id, 20, 'Loading idea canvas...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();

      setProgress(task.task_id, 30, 'Loading scores...');
      const { data: scores } = await supabase.from('scores').select('*').eq('project_id', projectId).maybeSingle();

      const context = {
        metrics: metricsWithEntries,
        burn_rate: burnRate,
        idea_canvas: ideaCanvas,
        scores,
      };

      setProgress(task.task_id, 40, 'Analyzing startup health...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: ANALYZE_PROMPT },
        { role: 'user', content: `Analyze this startup's current state:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating health assessment...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 80, 'Updating alerts...');
      if (Array.isArray(r.alerts)) {
        const alertRows = (r.alerts as Record<string, unknown>[]).map((alert) => ({
          project_id: projectId,
          type: (alert.category as string) || 'other',
          severity: (alert.severity as string) || 'info',
          message: `${alert.title}: ${alert.message}`,
          dismissed: false,
        }));
        if (alertRows.length > 0) {
          await supabase.from('alerts').insert(alertRows);
        }
      }

      setProgress(task.task_id, 90, 'Saving analysis...');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
