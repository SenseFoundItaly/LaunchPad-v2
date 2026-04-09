import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { PITCH_ITERATE_PROMPT } from '@/lib/llm/prompts';
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

  const task = createTask('pitch_iterate', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading fundraising data...');
      const { data: round } = await supabase.from('fundraising_rounds').select('*').eq('project_id', projectId).maybeSingle();
      const { data: investors } = await supabase.from('investors').select('*').eq('project_id', projectId);
      const { data: pitchVersions } = await supabase
        .from('pitch_versions')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: true });

      // Gather investor feedback
      const feedback: { investor: string; feedback: string }[] = [];
      for (const inv of (investors || [])) {
        const { data: interactions } = await supabase
          .from('investor_interactions')
          .select('*')
          .eq('investor_id', inv.id);
        for (const inter of (interactions || [])) {
          if (inter.summary) {
            feedback.push({ investor: inv.name as string, feedback: inter.summary as string });
          }
        }
      }

      setProgress(task.task_id, 20, 'Loading startup context...');
      const [ideaResult, scoreResult, metricsResult, simResult] = await Promise.all([
        supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle(),
        supabase.from('scores').select('*').eq('project_id', projectId).maybeSingle(),
        supabase.from('metrics').select('*').eq('project_id', projectId),
        supabase.from('simulation').select('*').eq('project_id', projectId).maybeSingle(),
      ]);

      const context = {
        idea_canvas: ideaResult.data,
        scores: scoreResult.data,
        metrics: metricsResult.data || [],
        simulation: simResult.data,
        previous_pitch_versions: pitchVersions || [],
        investor_feedback: feedback,
        round,
      };

      setProgress(task.task_id, 40, 'Iterating on pitch...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: PITCH_ITERATE_PROMPT },
        { role: 'user', content: `Improve the pitch based on this context:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating improved pitch...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 80, 'Saving pitch version...');
      const { data: savedPitch } = await supabase
        .from('pitch_versions')
        .insert({
          project_id: projectId,
          version_number: r.version_number || (pitchVersions || []).length + 1,
          slides: r.key_slides,
          feedback_summary: r.pitch_narrative || '',
          changelog: r.changes_from_previous || [],
        })
        .select()
        .single();

      const pitchVersion = { ...(savedPitch || {}), ...r };
      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, pitchVersion as Record<string, unknown>);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
