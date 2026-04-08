import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();

  if (!body?.name || !body?.node_type) {
    return error('name and node_type are required');
  }

  const rows = query('SELECT id FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}

  // UPSERT: check for existing node with same name + project_id
  const existing = get(
    'SELECT * FROM graph_nodes WHERE project_id = ? AND name = ?',
    projectId,
    body.name,
  );

  if (existing) {
    // Update existing node
    run(
      `UPDATE graph_nodes SET node_type = ?, summary = ?, attributes = ? WHERE id = ?`,
      body.node_type,
      body.summary || existing.summary || '',
      JSON.stringify(body.attributes || {}),
      existing.id,
    );
    const updated = get('SELECT * FROM graph_nodes WHERE id = ?', existing.id);
    return json({
      ...updated,
      attributes: typeof updated!.attributes === 'string'
        ? JSON.parse(updated!.attributes)
        : (updated!.attributes || {}),
    });
  }

  // Create new node
  const id = generateId('gn');
  const now = new Date().toISOString();

  run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    body.name,
    body.node_type,
    body.summary || '',
    JSON.stringify(body.attributes || {}),
    now,
  );

  const created = get('SELECT * FROM graph_nodes WHERE id = ?', id);
  return json({
    ...created,
    attributes: typeof created!.attributes === 'string'
      ? JSON.parse(created!.attributes)
      : (created!.attributes || {}),
  }, 201);
}
