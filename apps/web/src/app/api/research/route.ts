import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import { RESEARCH_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) {return error('project_id required');}

  const task = createTask('research', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading idea canvas...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      if (ideaRows.length === 0) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      setProgress(task.task_id, 30, 'Researching market size...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: RESEARCH_PROMPT },
        { role: 'user', content: `Research this startup idea:\n\n${JSON.stringify(ideaRows[0], null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Analyzing competitors and trends...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Saving results...');
      const existing = await query('SELECT project_id FROM research WHERE project_id = ?', projectId);
      if (existing.length > 0) {
        await run(
          `UPDATE research SET market_size = ?, competitors = ?, trends = ?, case_studies = ?, key_insights = ?, researched_at = ?
           WHERE project_id = ?`,
          JSON.stringify(r.market_size),
          JSON.stringify(r.competitors),
          JSON.stringify(r.trends),
          JSON.stringify(r.case_studies),
          JSON.stringify(r.key_insights),
          new Date().toISOString(),
          projectId,
        );
      } else {
        await run(
          `INSERT INTO research (project_id, market_size, competitors, trends, case_studies, key_insights, researched_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          projectId,
          JSON.stringify(r.market_size),
          JSON.stringify(r.competitors),
          JSON.stringify(r.trends),
          JSON.stringify(r.case_studies),
          JSON.stringify(r.key_insights),
          new Date().toISOString(),
        );
      }

      await run(
        `UPDATE projects SET status = 'researched', current_step = GREATEST(current_step, 3), updated_at = ? WHERE id = ?`,
        new Date().toISOString(),
        projectId,
      );

      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
