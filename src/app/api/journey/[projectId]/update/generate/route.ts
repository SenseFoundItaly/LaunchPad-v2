import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { UPDATE_GENERATE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('generate_update', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading metrics...');
      const metricsRows = await query('SELECT * FROM metrics WHERE project_id = ?', projectId);
      for (const m of metricsRows) {
        m.entries = await query('SELECT * FROM metric_entries WHERE metric_id = ? ORDER BY date', m.id);
      }

      setProgress(task.task_id, 20, 'Loading context...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      const projects = await query('SELECT * FROM projects WHERE id = ?', projectId);
      const milestones = await query('SELECT * FROM milestones WHERE project_id = ?', projectId);
      const prevUpdates = await query(
        'SELECT * FROM startup_updates WHERE project_id = ? ORDER BY date DESC LIMIT 3',
        projectId,
      );

      const project = projects.length > 0 ? (projects[0]) : null;
      let currentStage = 'idea';
      if (project) {
        const step = project.current_step as number;
        if (step >= 5) {currentStage = 'scale';}
        else if (step >= 4) {currentStage = 'growth';}
        else if (step >= 3) {currentStage = 'pmf';}
        else if (step >= 2) {currentStage = 'mvp';}
      }

      const context = {
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        metrics: metricsRows,
        current_stage: currentStage,
        milestones,
        previous_updates: prevUpdates,
      };

      setProgress(task.task_id, 40, 'Generating update...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: UPDATE_GENERATE_PROMPT },
        { role: 'user', content: `Generate a founder update from this data:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Drafting update...');
      const result = await chatJSONByTask(messages, 'update-generate');
      const r = result;

      setProgress(task.task_id, 80, 'Saving update...');
      const updId = generateId('upd');
      await run(
        `INSERT INTO startup_updates (id, project_id, period, metrics_snapshot, highlights, challenges, asks, morale, generated_summary, date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        updId,
        projectId,
        (r.period as string) || '',
        JSON.stringify(r.metrics_snapshot || []),
        JSON.stringify(r.highlights || []),
        JSON.stringify(r.challenges || []),
        JSON.stringify(r.asks || []),
        r.morale || null,
        r.lesson_learned || null,
        new Date().toISOString().split('T')[0],
      );

      const update = { id: updId, generated: true, ...r };
      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, update as Record<string, unknown>);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
