import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { chatJSONByTask } from '@/lib/llm';
import { SIMULATION_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) {return error('project_id required');}
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const task = createTask('simulation', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading project data...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = $1', projectId);
      if (ideaRows.length === 0) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      const scoreRows = await query('SELECT * FROM scores WHERE project_id = $1', projectId);
      const researchRows = await query('SELECT * FROM research WHERE project_id = $1', projectId);

      let context = `Idea Canvas:\n${JSON.stringify(ideaRows[0], null, 2)}`;
      if (scoreRows.length > 0) {context += `\n\nScoring Results:\n${JSON.stringify(scoreRows[0], null, 2)}`;}
      if (researchRows.length > 0) {context += `\n\nMarket Research:\n${JSON.stringify(researchRows[0], null, 2)}`;}

      setProgress(task.task_id, 30, 'Generating personas...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: SIMULATION_PROMPT },
        { role: 'user', content: `Simulate market reception for:\n\n${context}` },
      ];

      setProgress(task.task_id, 60, 'Running simulation...');
      const result = await chatJSONByTask(messages, 'simulation', { projectId });
      const r = result;

      setProgress(task.task_id, 90, 'Saving results...');
      const existing = await query('SELECT project_id FROM simulation WHERE project_id = $1', projectId);
      if (existing.length > 0) {
        await run(
          `UPDATE simulation SET personas = $1, risk_scenarios = $2, market_reception_summary = $3, investor_sentiment = $4, simulated_at = $5
           WHERE project_id = $6`,
          JSON.stringify(r.personas),
          JSON.stringify(r.risk_scenarios),
          r.market_reception_summary,
          r.investor_sentiment,
          new Date().toISOString(),
          projectId,
        );
      } else {
        await run(
          `INSERT INTO simulation (project_id, personas, risk_scenarios, market_reception_summary, investor_sentiment, simulated_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          projectId,
          JSON.stringify(r.personas),
          JSON.stringify(r.risk_scenarios),
          r.market_reception_summary,
          r.investor_sentiment,
          new Date().toISOString(),
        );
      }

      await run(
        `UPDATE projects SET status = 'simulated', current_step = GREATEST(current_step, 4), updated_at = $1 WHERE id = $2`,
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
