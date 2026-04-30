import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { SCORING_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) {return error('project_id required');}

  const task = createTask('scoring', projectId);

  // Run in background
  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading idea canvas...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      if (ideaRows.length === 0) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      setProgress(task.task_id, 30, 'Analyzing startup idea...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SCORING_PROMPT },
        { role: 'user', content: `Score this startup idea:\n\n${JSON.stringify(ideaRows[0], null, 2)}` },
      ];

      setProgress(task.task_id, 50, 'Running multi-dimensional scoring...');
      const result = await chatJSONByTask(messages, 'scoring', { projectId });

      setProgress(task.task_id, 90, 'Saving results...');
      // Upsert scores
      const existing = await query('SELECT project_id FROM scores WHERE project_id = ?', projectId);
      if (existing.length > 0) {
        await run(
          `UPDATE scores SET overall_score = ?, dimensions = ?, benchmark = ?, recommendation = ?, scored_at = ?
           WHERE project_id = ?`,
          (result).overall_score,
          JSON.stringify((result).dimensions),
          (result).benchmark_comparison,
          (result).top_recommendation,
          new Date().toISOString(),
          projectId,
        );
      } else {
        await run(
          `INSERT INTO scores (project_id, overall_score, dimensions, benchmark, recommendation, scored_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          projectId,
          (result).overall_score,
          JSON.stringify((result).dimensions),
          (result).benchmark_comparison,
          (result).top_recommendation,
          new Date().toISOString(),
        );
      }

      // Update project status
      await run(
        `UPDATE projects SET status = 'scored', current_step = GREATEST(current_step, 2), updated_at = ? WHERE id = ?`,
        new Date().toISOString(),
        projectId,
      );

      completeTask(task.task_id, result);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
