import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query('SELECT id FROM projects WHERE id = ?', projectId);
  if (rows.length === 0) {return error('Project not found', 404);}

  const nodes = await query(
    "SELECT * FROM graph_nodes WHERE project_id = ? AND reviewed_state = 'applied' ORDER BY created_at",
    projectId,
  );
  const edges = await query('SELECT * FROM graph_edges WHERE project_id = ? ORDER BY created_at', projectId);

  // attributes is JSONB — postgres.js returns it already parsed
  const parsedNodes = nodes.map((n: Record<string, unknown>) => ({
    ...n,
    attributes: n.attributes || {},
  }));

  // Only include edges where both endpoints are applied (visible) nodes
  const appliedNodeIds = new Set(parsedNodes.map((n: Record<string, unknown>) => n.id));

  // Map edge fields to match GraphEdge interface (source/target instead of source_node_id/target_node_id)
  const parsedEdges = edges
    .filter((e: Record<string, unknown>) =>
      appliedNodeIds.has(e.source_node_id as string) && appliedNodeIds.has(e.target_node_id as string),
    )
    .map((e: Record<string, unknown>) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      relation: e.relation,
      label: e.label,
      weight: e.weight,
    }));

  return json({ nodes: parsedNodes, edges: parsedEdges });
}
