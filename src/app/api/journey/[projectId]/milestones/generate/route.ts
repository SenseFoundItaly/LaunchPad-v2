import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { MILESTONES_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('generate_milestones', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading journey data...');
      const projects = await query('SELECT * FROM projects WHERE id = ?', projectId);
      const project = projects.length > 0 ? (projects[0]) : null;

      let currentStage = 'idea';
      if (project) {
        const step = project.current_step as number;
        if (step >= 5) {currentStage = 'scale';}
        else if (step >= 4) {currentStage = 'growth';}
        else if (step >= 3) {currentStage = 'pmf';}
        else if (step >= 2) {currentStage = 'mvp';}
      }

      setProgress(task.task_id, 20, 'Loading startup context...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      const scoreRows = await query('SELECT * FROM scores WHERE project_id = ?', projectId);

      const context = {
        current_stage: currentStage,
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        scores: scoreRows.length > 0 ? scoreRows[0] : null,
      };

      setProgress(task.task_id, 40, 'Generating milestones...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: MILESTONES_PROMPT },
        { role: 'user', content: `Generate milestones for this startup:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 60, 'Processing milestones...');
      const result = await chatJSONByTask(messages, 'milestones', 0.3, {
        project_id: projectId,
        skill_id: 'milestones-generate',
        step: 'journey.milestones.generate',
      });
      const r = result;

      setProgress(task.task_id, 80, 'Saving milestones...');
      // Clear existing milestones for this project
      await run('DELETE FROM milestones WHERE project_id = ?', projectId);

      const milestones = (r.milestones as Record<string, unknown>[]) || [];
      for (let i = 0; i < milestones.length; i++) {
        const ms = milestones[i];
        const msId = generateId('ms');
        await run(
          `INSERT INTO milestones (id, project_id, week, phase, title, description, status, linked_feature)
           VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?)`,
          msId,
          projectId,
          ms.estimated_weeks || i + 1,
          ms.category || currentStage,
          ms.title,
          ms.description || '',
          ms.linked_feature || null,
        );
      }

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
