import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { PITCH_ITERATE_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('pitch_iterate', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading fundraising data...');
      const roundRows = await query('SELECT * FROM fundraising_rounds WHERE project_id = ?', projectId);
      const investors = await query('SELECT * FROM investors WHERE project_id = ?', projectId);
      const pitchVersions = await query('SELECT * FROM pitch_versions WHERE project_id = ? ORDER BY created_at', projectId);

      // Gather investor feedback
      const feedback: { investor: string; feedback: string }[] = [];
      for (const inv of investors) {
        const interactions = await query(
          'SELECT * FROM investor_interactions WHERE investor_id = ?',
          inv.id,
        );
        for (const inter of interactions) {
          if (inter.summary) {
            feedback.push({ investor: inv.name as string, feedback: inter.summary as string });
          }
        }
      }

      setProgress(task.task_id, 20, 'Loading startup context...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      const scoreRows = await query('SELECT * FROM scores WHERE project_id = ?', projectId);
      const metricsRows = await query('SELECT * FROM metrics WHERE project_id = ?', projectId);
      const simRows = await query('SELECT * FROM simulation WHERE project_id = ?', projectId);

      const context = {
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        scores: scoreRows.length > 0 ? scoreRows[0] : null,
        metrics: metricsRows,
        simulation: simRows.length > 0 ? simRows[0] : null,
        previous_pitch_versions: pitchVersions,
        investor_feedback: feedback,
        round: roundRows.length > 0 ? roundRows[0] : null,
      };

      setProgress(task.task_id, 40, 'Iterating on pitch...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: PITCH_ITERATE_PROMPT },
        { role: 'user', content: `Improve the pitch based on this context:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Generating improved pitch...');
      const result = await chatJSONByTask(messages, 'pitch-iterate', { projectId });
      const r = result;

      setProgress(task.task_id, 80, 'Saving pitch version...');
      const pitchId = generateId('pitch');
      await run(
        `INSERT INTO pitch_versions (id, project_id, version_number, slides, feedback_summary, changelog, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        pitchId,
        projectId,
        r.version_number || pitchVersions.length + 1,
        JSON.stringify(r.key_slides),
        r.pitch_narrative || '',
        JSON.stringify(r.changes_from_previous || []),
        new Date().toISOString(),
      );

      const pitchVersion = { id: pitchId, ...r };
      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, pitchVersion as Record<string, unknown>);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
