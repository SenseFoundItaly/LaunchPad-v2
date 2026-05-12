import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, mapProject } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query('SELECT * FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}
  return json(mapProject(rows[0]));
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

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

  await run(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`, ...values);
  const rows = await query('SELECT * FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}
  return json(mapProject(rows[0]));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  // All child tables use ON DELETE CASCADE — a single delete propagates
  // to all 30+ dependent tables automatically without manual cleanup.
  await run('DELETE FROM projects WHERE id = ?', projectId);

  return json(null);
}
