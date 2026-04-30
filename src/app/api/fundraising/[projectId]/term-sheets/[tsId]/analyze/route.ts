import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { TERM_SHEET_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; tsId: string }> },
) {
  const { projectId, tsId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('term_sheet_analyze', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading term sheet...');
      const tsRows = await query('SELECT * FROM term_sheets WHERE id = ?', tsId);
      if (tsRows.length === 0) {
        failTask(task.task_id, 'Term sheet not found.');
        return;
      }

      setProgress(task.task_id, 20, 'Loading round context...');
      const roundRows = await query('SELECT * FROM fundraising_rounds WHERE project_id = ?', projectId);

      const context = {
        term_sheet: tsRows[0],
        round: roundRows.length > 0 ? roundRows[0] : null,
      };

      setProgress(task.task_id, 40, 'Analyzing terms...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: TERM_SHEET_PROMPT },
        { role: 'user', content: `Analyze this term sheet:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating analysis...');
      const result = await chatJSONByTask(messages, 'term-sheet', { projectId });
      const r = result;

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
