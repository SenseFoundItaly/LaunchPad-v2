import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { ITERATE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string }> },
) {
  const { projectId, loopId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }
  const provider = body?.provider || 'openai';

  const task = createTask('growth_iterate', projectId);

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

      setProgress(task.task_id, 20, 'Loading startup context...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      const scoreRows = await query('SELECT * FROM scores WHERE project_id = ?', projectId);
      const metricsRows = await query('SELECT * FROM metrics WHERE project_id = ?', projectId);

      const loop = loops[0];
      loop.iterations = iterations;

      const context = {
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        scores: scoreRows.length > 0 ? scoreRows[0] : null,
        metrics: metricsRows,
        loop,
      };

      setProgress(task.task_id, 40, 'Analyzing prior iterations...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: ITERATE_PROMPT },
        { role: 'user', content: `Generate the next optimization iteration:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating next experiment...');
      const result = await chatJSONByTask(messages, 'growth-iterate', { projectId });
      const r = result;

      setProgress(task.task_id, 80, 'Saving iteration...');
      const iterId = generateId('iter');
      await run(
        `INSERT INTO growth_iterations (id, loop_id, hypothesis, proposed_changes, status, created_at)
         VALUES (?, ?, ?, ?, 'proposed', ?)`,
        iterId,
        loopId,
        r.hypothesis,
        JSON.stringify(r.proposed_changes),
        new Date().toISOString(),
      );

      const [iteration] = await query('SELECT * FROM growth_iterations WHERE id = ?', iterId);
      const iterWithLLM = { ...(iteration), ...r };

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, iterWithLLM as Record<string, unknown>);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
