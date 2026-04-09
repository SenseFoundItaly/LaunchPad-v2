import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { WORKFLOW_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  try { await requireUser(); } catch { return unauthorized(); }

  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) return error('project_id required');

  const task = createTask('workflow', projectId);

  setTimeout(async () => {
    try {
      const supabase = await createServerSupabase();

      setProgress(task.task_id, 10, 'Loading project data...');
      const { data: ideaCanvas } = await supabase.from('idea_canvas').select('*').eq('project_id', projectId).maybeSingle();
      if (!ideaCanvas) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      const { data: scores } = await supabase.from('scores').select('*').eq('project_id', projectId).maybeSingle();
      const { data: research } = await supabase.from('research').select('*').eq('project_id', projectId).maybeSingle();
      const { data: simulation } = await supabase.from('simulation').select('*').eq('project_id', projectId).maybeSingle();

      let context = `Idea Canvas:\n${JSON.stringify(ideaCanvas, null, 2)}`;
      if (scores) context += `\n\nScoring:\n${JSON.stringify(scores, null, 2)}`;
      if (research) context += `\n\nResearch:\n${JSON.stringify(research, null, 2)}`;
      if (simulation) context += `\n\nSimulation Results:\n${JSON.stringify(simulation, null, 2)}`;

      setProgress(task.task_id, 30, 'Generating GTM strategy...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: WORKFLOW_PROMPT },
        { role: 'user', content: `Create a launch plan for:\n\n${context}` },
      ];

      setProgress(task.task_id, 60, 'Building pitch deck and financials...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Saving results...');
      await supabase
        .from('workflow')
        .upsert(
          {
            project_id: projectId,
            gtm_strategy: r.gtm_strategy,
            pitch_deck: r.pitch_deck,
            financial_model: r.financial_model,
            roadmap: r.roadmap,
            action_items: r.action_items,
            generated_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' },
        );

      await supabase
        .from('projects')
        .update({ status: 'workflow_complete', current_step: 5, updated_at: new Date().toISOString() })
        .eq('id', projectId);

      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
