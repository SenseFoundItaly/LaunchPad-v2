import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();

  if (!body?.name) {return error('name is required');}

  const id = generateId('inv');
  const now = new Date().toISOString();
  await run(
    `INSERT INTO investors (id, project_id, name, type, contact_name, contact_email, stage, check_size, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    body.name,
    body.type || null,
    body.contact_name || body.firm || '',
    body.email || '',
    body.stage || 'identified',
    body.check_size || null,
    body.notes || '',
    JSON.stringify(body.tags || []),
    now,
    now,
  );

  const [investor] = await query('SELECT * FROM investors WHERE id = ?', id);
  return json(investor, 201);
}
