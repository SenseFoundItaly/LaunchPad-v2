import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { SCALING_PLAN_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json().catch(() => ({}));
  const provider = body?.provider || 'openai';

  const task = createTask('scaling_plan', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading startup data...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      const scoreRows = await query('SELECT * FROM scores WHERE project_id = ?', projectId);
      const metricsRows = await query('SELECT * FROM metrics WHERE project_id = ?', projectId);
      const growthLoops = await query('SELECT * FROM growth_loops WHERE project_id = ?', projectId);
      const milestones = await query('SELECT * FROM milestones WHERE project_id = ?', projectId);
      const roundRows = await query('SELECT * FROM fundraising_rounds WHERE project_id = ?', projectId);

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

      const context = {
        idea_canvas: ideaRows.length > 0 ? ideaRows[0] : null,
        scores: scoreRows.length > 0 ? scoreRows[0] : null,
        metrics: metricsRows,
        growth_loops: growthLoops,
        current_stage: currentStage,
        milestones,
        fundraising: roundRows.length > 0 ? roundRows[0] : null,
      };

      setProgress(task.task_id, 30, 'Analyzing growth trajectory...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SCALING_PLAN_PROMPT },
        { role: 'user', content: `Create a scaling plan for this startup:\n\n${JSON.stringify(context, null, 2)}` },
      ];

      setProgress(task.task_id, 50, 'Building scaling plan...');
      const result = await chatJSONByTask(messages, 'scaling-plan', { projectId });
      const r = result;

      setProgress(task.task_id, 90, 'Done.');
      completeTask(task.task_id, r);
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
