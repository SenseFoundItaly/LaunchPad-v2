import { NextRequest } from 'next/server';
import { createServerSupabase, requireUser } from '@/lib/supabase/server';
import { chatJSON } from '@/lib/llm';
import { SIMULATION_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error, unauthorized } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  try { await requireUser(); } catch { return unauthorized(); }

  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) return error('project_id required');

  const task = createTask('simulation', projectId);

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

      let context = `Idea Canvas:\n${JSON.stringify(ideaCanvas, null, 2)}`;
      if (scores) context += `\n\nScoring Results:\n${JSON.stringify(scores, null, 2)}`;
      if (research) context += `\n\nMarket Research:\n${JSON.stringify(research, null, 2)}`;

      setProgress(task.task_id, 30, 'Generating personas...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SIMULATION_PROMPT },
        { role: 'user', content: `Simulate market reception for:\n\n${context}` },
      ];

      setProgress(task.task_id, 60, 'Running simulation...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Saving results...');
      await supabase
        .from('simulation')
        .upsert(
          {
            project_id: projectId,
            personas: r.personas,
            risk_scenarios: r.risk_scenarios,
            market_reception_summary: r.market_reception_summary,
            investor_sentiment: r.investor_sentiment,
            simulated_at: new Date().toISOString(),
          },
          { onConflict: 'project_id' },
        );

      await supabase
        .from('projects')
        .update({ status: 'simulated', current_step: 4, updated_at: new Date().toISOString() })
        .eq('id', projectId);

      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
