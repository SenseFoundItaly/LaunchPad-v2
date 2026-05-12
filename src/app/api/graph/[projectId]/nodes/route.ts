import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
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

  if (!body?.name || !body?.node_type) {
    return error('name and node_type are required');
  }

  // UPSERT: check for existing node with same name + project_id
  const existing = await get(
    'SELECT * FROM graph_nodes WHERE project_id = $1 AND name = $2',
    projectId,
    body.name,
  );

  if (existing) {
    // Update existing node
    await run(
      `UPDATE graph_nodes SET node_type = $1, summary = $2, attributes = $3 WHERE id = $4`,
      body.node_type,
      body.summary || existing.summary || '',
      JSON.stringify(body.attributes || {}),
      existing.id,
    );
    const updated = await get('SELECT * FROM graph_nodes WHERE id = $1', existing.id);
    return json({
      ...updated,
      attributes: updated!.attributes || {},
    });
  }

  // Create new node
  const id = generateId('gn');
  const now = new Date().toISOString();

  await run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    id,
    projectId,
    body.name,
    body.node_type,
    body.summary || '',
    JSON.stringify(body.attributes || {}),
    now,
  );

  const created = await get('SELECT * FROM graph_nodes WHERE id = $1', id);
  return json({
    ...created,
    attributes: created!.attributes || {},
  }, 201);
}
