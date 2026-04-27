import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  if (!body?.source_node_id || !body?.target_node_id || !body?.relation) {
    return error('source_node_id, target_node_id, and relation are required');
  }

  // Skip temp IDs (optimistic frontend state)
  if (body.source_node_id.startsWith('gn_temp_') || body.target_node_id.startsWith('gn_temp_')) {
    return json({ id: 'skipped', source: body.source_node_id, target: body.target_node_id, relation: body.relation, label: '', weight: 1.0 });
  }

  const rows = await query('SELECT id FROM projects WHERE id = $1', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}

  // Verify both nodes exist
  const srcNode = await get('SELECT id FROM graph_nodes WHERE id = $1', body.source_node_id);
  const tgtNode = await get('SELECT id FROM graph_nodes WHERE id = $1', body.target_node_id);
  if (!srcNode || !tgtNode) {
    return json({ id: 'skipped', source: body.source_node_id, target: body.target_node_id, relation: body.relation, label: '', weight: 1.0 });
  }

  // Check for duplicate
  const existing = await get(
    'SELECT * FROM graph_edges WHERE project_id = $1 AND source_node_id = $2 AND target_node_id = $3 AND relation = $4',
    projectId, body.source_node_id, body.target_node_id, body.relation,
  );

  if (existing) {
    return json({
      id: existing.id, source: existing.source_node_id, target: existing.target_node_id,
      relation: existing.relation, label: existing.label, weight: existing.weight,
    });
  }

  try {
    const id = generateId('ge');
    await run(
      `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, label, weight, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      id, projectId, body.source_node_id, body.target_node_id,
      body.relation, body.label || '', body.weight ?? 1.0, new Date().toISOString(),
    );

    const created = await get('SELECT * FROM graph_edges WHERE id = $1', id);
    return json({
      id: created!.id, source: created!.source_node_id, target: created!.target_node_id,
      relation: created!.relation, label: created!.label, weight: created!.weight,
    }, 201);
  } catch (err) {
    console.error('Edge creation error:', err);
    return json({ id: 'error', source: body.source_node_id, target: body.target_node_id, relation: body.relation, label: '', weight: 1.0 });
  }
}
