import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { ANALYZE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('dashboard_analyze', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading metrics data...');
      const metrics = await query('SELECT * FROM metrics WHERE project_id = ?', projectId);
      for (const m of metrics) {
        m.entries = await query('SELECT * FROM metric_entries WHERE metric_id = ? ORDER BY date', m.id);
      }
      const burnRateRows = await query('SELECT * FROM burn_rate WHERE project_id = ?', projectId);

      setProgress(task.task_id, 20, 'Loading idea canvas...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);

      setProgress(task.task_id, 30, 'Loading scores...');
      const scoreRows = await query('SELECT * FROM scores WHERE project_id = ?', projectId);

      const context = {
        metrics,
        burn_rate: burnRateRows.length > 0 ? burnRateRows[0] : null,
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        scores: scoreRows.length > 0 ? scoreRows[0] : null,
      };

      setProgress(task.task_id, 40, 'Analyzing startup health...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: ANALYZE_PROMPT },
        { role: 'user', content: `Analyze this startup's current state:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating health assessment...');
      const result = await chatJSONByTask(messages, 'summarize');
      const r = result;

      setProgress(task.task_id, 80, 'Updating alerts...');
      if (Array.isArray(r.alerts)) {
        for (const alert of r.alerts as Record<string, unknown>[]) {
          const alertId = generateId('alt');
          await run(
            `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, created_at)
             VALUES (?, ?, ?, ?, ?, false, ?)`,
            alertId,
            projectId,
            (alert.category as string) || 'other',
            (alert.severity as string) || 'info',
            `${alert.title}: ${alert.message}`,
            new Date().toISOString(),
          );
        }
      }

      setProgress(task.task_id, 90, 'Saving analysis...');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
