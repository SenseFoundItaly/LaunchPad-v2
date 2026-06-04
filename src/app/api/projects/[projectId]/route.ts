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

  // LEFT JOIN owner email so the TopBar "shared by X" chip can render
  // without a second fetch for shared-view sessions.
  const rows = await query(
    `SELECT p.*, u.email AS owner_email
       FROM projects p
       LEFT JOIN users u ON u.id = p.owner_user_id
      WHERE p.id = ?`,
    projectId,
  );
  if (rows.length === 0) {return error('Project not found', 404);}
  const mapped = mapProject(rows[0]);
  mapped.access_kind = auth.session.accessKind;
  return json(mapped);
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
  // Owner-only — shared members can read/edit but never delete the project.
  if (auth.session.accessKind !== 'owner') {
    return error('Only the project owner can delete this project', 403);
  }

  // All child tables use ON DELETE CASCADE — a single delete propagates
  // to all 30+ dependent tables automatically without manual cleanup.
  await run('DELETE FROM projects WHERE id = ?', projectId);

  return json(null);
}
