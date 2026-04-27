import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { INVESTOR_UPDATE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('investor_update', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading metrics...');
      const metricsRows = await query('SELECT * FROM metrics WHERE project_id = ?', projectId);
      for (const m of metricsRows) {
        m.entries = await query('SELECT * FROM metric_entries WHERE metric_id = ? ORDER BY date', m.id);
      }
      const burnRateRows = await query('SELECT * FROM burn_rate WHERE project_id = ?', projectId);

      setProgress(task.task_id, 20, 'Loading startup context...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      const roundRows = await query('SELECT * FROM fundraising_rounds WHERE project_id = ?', projectId);
      const investorCount = await query('SELECT COUNT(*) as cnt FROM investors WHERE project_id = ?', projectId);

      const context = {
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        metrics: metricsRows,
        burn_rate: burnRateRows.length > 0 ? burnRateRows[0] : null,
        round: roundRows.length > 0 ? roundRows[0] : null,
        investor_count: (investorCount[0])?.cnt || 0,
      };

      setProgress(task.task_id, 40, 'Generating investor update...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: INVESTOR_UPDATE_PROMPT },
        { role: 'user', content: `Generate an investor update from this data:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Drafting update email...');
      const result = await chatJSONByTask(messages, 'investor-update', 0.3, {
        project_id: projectId,
        skill_id: 'investor-update',
        step: 'fundraising.investor-update',
      });
      const r = result;

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
