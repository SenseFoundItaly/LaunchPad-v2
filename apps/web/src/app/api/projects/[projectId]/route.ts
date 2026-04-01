import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, mapProject } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rows = query('SELECT * FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}
  return json(mapProject(rows[0]));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ['name', 'description', 'status', 'current_step', 'llm_provider']) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }
  if (fields.length === 0) {return error('No fields to update');}

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(projectId);

  run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, ...values);
  const rows = query('SELECT * FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}
  return json(mapProject(rows[0]));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rows = query('SELECT id FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}

  const tables = [
    'idea_canvas', 'scores', 'research', 'simulation', 'workflow',
    'burn_rate', 'chat_messages', 'startup_updates', 'milestones',
    'pitch_versions', 'alerts', 'fundraising_rounds',
  ];
  for (const table of tables) {
    run(`DELETE FROM ${table} WHERE project_id = ?`, projectId);
  }
  const metrics = query<{ id: string }>('SELECT id FROM metrics WHERE project_id = ?', projectId);
  for (const m of metrics) {
    run('DELETE FROM metric_entries WHERE metric_id = ?', m.id);
  }
  run('DELETE FROM metrics WHERE project_id = ?', projectId);

  const investors = query<{ id: string }>('SELECT id FROM investors WHERE project_id = ?', projectId);
  for (const inv of investors) {
    run('DELETE FROM investor_interactions WHERE investor_id = ?', inv.id);
    run('DELETE FROM term_sheets WHERE investor_id = ?', inv.id);
  }
  run('DELETE FROM investors WHERE project_id = ?', projectId);

  const loops = query<{ id: string }>('SELECT id FROM growth_loops WHERE project_id = ?', projectId);
  for (const l of loops) {
    run('DELETE FROM growth_iterations WHERE loop_id = ?', l.id);
  }
  run('DELETE FROM growth_loops WHERE project_id = ?', projectId);
  run('DELETE FROM term_sheets WHERE project_id = ?', projectId);
  run('DELETE FROM projects WHERE id = ?', projectId);

  return json(null);
}
