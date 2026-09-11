import { NextRequest } from 'next/server';
import { v4 as uuid } from 'uuid';
import { query, run } from '@/lib/db';
import { chatJSON } from '@/lib/llm';
import { WORKFLOW_PROMPT } from '@/lib/llm/prompts';
import { createTask, setProgress, completeTask, failTask } from '@/lib/tasks';
import { json, error } from '@/lib/api-helpers';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const projectId = body?.project_id;
  const provider = body?.provider || 'openai';

  if (!projectId) {return error('project_id required');}

  const task = createTask('workflow', projectId);

  setTimeout(async () => {
    try {
      setProgress(task.task_id, 10, 'Loading project data...');
      const ideaRows = await query('SELECT * FROM idea_canvas WHERE project_id = ?', projectId);
      if (ideaRows.length === 0) {
        failTask(task.task_id, 'No idea canvas found. Complete Step 1 first.');
        return;
      }

      const scoreRows = await query('SELECT * FROM scores WHERE project_id = ?', projectId);
      const researchRows = await query('SELECT * FROM research WHERE project_id = ?', projectId);
      const simRows = await query('SELECT * FROM simulation WHERE project_id = ?', projectId);

      let context = `Idea Canvas:\n${JSON.stringify(ideaRows[0], null, 2)}`;
      if (scoreRows.length > 0) {context += `\n\nScoring:\n${JSON.stringify(scoreRows[0], null, 2)}`;}
      if (researchRows.length > 0) {context += `\n\nResearch:\n${JSON.stringify(researchRows[0], null, 2)}`;}
      if (simRows.length > 0) {context += `\n\nSimulation Results:\n${JSON.stringify(simRows[0], null, 2)}`;}

      setProgress(task.task_id, 30, 'Generating GTM strategy...');
      const messages: { role: 'system' | 'user'; content: string }[] = [
        { role: 'system', content: WORKFLOW_PROMPT },
        { role: 'user', content: `Create a launch plan for:\n\n${context}` },
      ];

      setProgress(task.task_id, 60, 'Building pitch deck and financials...');
      const result = await chatJSON(messages, provider);
      const r = result;

      setProgress(task.task_id, 90, 'Saving results...');
      const existing = await query('SELECT project_id FROM workflow WHERE project_id = ?', projectId);
      if (existing.length > 0) {
        await run(
          `UPDATE workflow SET gtm_strategy = ?, pitch_deck = ?, financial_model = ?, roadmap = ?, action_items = ?, generated_at = ?
           WHERE project_id = ?`,
          JSON.stringify(r.gtm_strategy),
          JSON.stringify(r.pitch_deck),
          JSON.stringify(r.financial_model),
          JSON.stringify(r.roadmap),
          JSON.stringify(r.action_items),
          new Date().toISOString(),
          projectId,
        );
      } else {
        await run(
          `INSERT INTO workflow (project_id, gtm_strategy, pitch_deck, financial_model, roadmap, action_items, generated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          projectId,
          JSON.stringify(r.gtm_strategy),
          JSON.stringify(r.pitch_deck),
          JSON.stringify(r.financial_model),
          JSON.stringify(r.roadmap),
          JSON.stringify(r.action_items),
          new Date().toISOString(),
        );
      }

      await run(
        `UPDATE projects SET status = 'workflow_complete', current_step = 5, updated_at = ? WHERE id = ?`,
        new Date().toISOString(),
        projectId,
      );

      // Auto-create drafts from workflow outputs
      const projectRows = query<{ name: string }>('SELECT name FROM projects WHERE id = ?', projectId);
      const projectName = projectRows[0]?.name || 'Startup';
      const draftsCreated: string[] = [];

      if (r.pitch_deck) {
        const draftId = `draft_${uuid().slice(0, 12)}`;
        const versionId = `dv_${uuid().slice(0, 12)}`;
        run(
          `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
           VALUES (?, ?, ?, 'pitch-deck', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          draftId, projectId, `${projectName} Pitch Deck`,
        );
        run(
          `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, changelog, created_by, created_at)
           VALUES (?, ?, 1, ?, 'slides-json', 'Generated from workflow', 'ai', CURRENT_TIMESTAMP)`,
          versionId, draftId, JSON.stringify(r.pitch_deck),
        );
        draftsCreated.push(draftId);
      }

      if (r.gtm_strategy) {
        const draftId = `draft_${uuid().slice(0, 12)}`;
        const versionId = `dv_${uuid().slice(0, 12)}`;
        run(
          `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
           VALUES (?, ?, ?, 'document', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          draftId, projectId, `${projectName} GTM Strategy`,
        );
        run(
          `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, changelog, created_by, created_at)
           VALUES (?, ?, 1, ?, 'markdown', 'Generated from workflow', 'ai', CURRENT_TIMESTAMP)`,
          versionId, draftId, JSON.stringify(r.gtm_strategy),
        );
        draftsCreated.push(draftId);
      }

      if (r.financial_model) {
        const draftId = `draft_${uuid().slice(0, 12)}`;
        const versionId = `dv_${uuid().slice(0, 12)}`;
        run(
          `INSERT INTO drafts (id, project_id, name, draft_type, status, current_version, created_at, updated_at)
           VALUES (?, ?, ?, 'document', 'draft', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          draftId, projectId, `${projectName} Financial Model`,
        );
        run(
          `INSERT INTO draft_versions (id, draft_id, version_number, content, content_type, changelog, created_by, created_at)
           VALUES (?, ?, 1, ?, 'markdown', 'Generated from workflow', 'ai', CURRENT_TIMESTAMP)`,
          versionId, draftId, JSON.stringify(r.financial_model),
        );
        draftsCreated.push(draftId);
      }

      completeTask(task.task_id, { ...r, drafts_created: draftsCreated });
    } catch (err) {
      failTask(task.task_id, err instanceof Error ? err.message : String(err));
    }
  }, 0);

  return json({ task_id: task.task_id });
}
