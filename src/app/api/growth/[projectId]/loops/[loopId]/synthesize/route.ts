import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { SYNTHESIZE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string }> },
) {
  const { projectId, loopId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('growth_synthesize', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading growth loop data...');
      const loops = await query('SELECT * FROM growth_loops WHERE id = ?', loopId);
      if (loops.length === 0) {
        failTask(task.task_id, 'Growth loop not found.');
        return;
      }

      const iterations = await query(
        'SELECT * FROM growth_iterations WHERE loop_id = ? ORDER BY created_at',
        loopId,
      );
      const loop = loops[0];
      loop.iterations = iterations;

      setProgress(task.task_id, 30, 'Preparing synthesis context...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SYNTHESIZE_PROMPT },
        { role: 'user', content: `Synthesize learnings from this optimization loop:\n\n${JSON.stringify(loop, null, 2)}` },
      ];

      setProgress(task.task_id, 50, 'Synthesizing learnings...');
      const result = await chatJSONByTask(messages, 'growth-synthesize', 0.3, {
        project_id: projectId,
        skill_id: 'growth-synthesize',
        step: 'growth.synthesize',
      });
      const r = result;

      setProgress(task.task_id, 80, 'Saving synthesis...');
      await run(
        `UPDATE growth_loops SET accumulated_learnings = ? WHERE id = ?`,
        (r.accumulated_learnings as string) || '',
        loopId,
      );

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
