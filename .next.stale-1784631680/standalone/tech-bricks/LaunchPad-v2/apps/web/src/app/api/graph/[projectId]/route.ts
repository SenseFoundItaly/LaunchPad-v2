import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const rows = query('SELECT id FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}

  const nodes = query('SELECT * FROM graph_nodes WHERE project_id = ? ORDER BY created_at', projectId);
  const edges = query('SELECT * FROM graph_edges WHERE project_id = ? ORDER BY created_at', projectId);

  // Parse JSON attributes for each node
  const parsedNodes = nodes.map((n: Record<string, unknown>) => ({
    ...n,
    attributes: typeof n.attributes === 'string' ? JSON.parse(n.attributes) : (n.attributes || {}),
  }));

  // Map edge fields to match GraphEdge interface (source/target instead of source_node_id/target_node_id)
  const parsedEdges = edges.map((e: Record<string, unknown>) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    relation: e.relation,
    label: e.label,
    weight: e.weight,
  }));

  return json({ nodes: parsedNodes, edges: parsedEdges });
}
