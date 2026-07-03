import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { nodeImportanceEnabled } from '@/lib/node-importance-flag';
import { isDerivedAnalysisNode } from '@/types/graph';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query<{ id: string; name: string | null }>(
    'SELECT id, name FROM projects WHERE id = ?',
    projectId,
  );
  if (rows.length === 0) {return error('Project not found', 404);}
  const projectName = (rows[0]?.name as string) || 'Your startup';

  // Include PENDING proposals alongside applied knowledge — the founder
  // reviews/applies them right in the graph (dashed nodes), so they must be
  // visible here even before they're folded into intelligence.
  const allNodes = await query(
    "SELECT * FROM graph_nodes WHERE project_id = ? AND reviewed_state IN ('applied','pending') ORDER BY created_at",
    projectId,
  );
  // Drop chat-artifact scaffolding (scorecards/dashboards/comparison dumps) so
  // the graph shows real ecosystem entities only — the "categorizzare meglio"
  // ask from the 2026-06 sync. Same predicate as the unified list.
  const nodes = allNodes.filter(
    (n: Record<string, unknown>) => !isDerivedAnalysisNode(n.node_type as string),
  );
  const edges = await query('SELECT * FROM graph_edges WHERE project_id = ? ORDER BY created_at', projectId);

  // attributes is JSONB — postgres.js returns it already parsed.
  // Variant-aware: only surface the cached AI importance for AI-variant projects,
  // so a control project always renders the deterministic template.
  const aiOn = nodeImportanceEnabled(projectId);
  const parsedNodes: Array<Record<string, unknown>> = nodes.map((n: Record<string, unknown>) => ({
    ...n,
    attributes: n.attributes || {},
    importance: aiOn ? (n.importance ?? null) : null,
  }));

  // Real edges: both endpoints must be visible (applied OR pending).
  const visibleNodeIds = new Set(parsedNodes.map((n: Record<string, unknown>) => n.id as string));

  // Map edge fields to match GraphEdge interface (source/target instead of source_node_id/target_node_id)
  const realEdges = edges
    .filter((e: Record<string, unknown>) =>
      visibleNodeIds.has(e.source_node_id as string) && visibleNodeIds.has(e.target_node_id as string),
    )
    .map((e: Record<string, unknown>) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      relation: e.relation,
      label: e.label,
      weight: e.weight,
      virtual: false,
    }));

  // "Linked to the project": pending proposals are created without edges, so
  // they'd float. Synthesize a virtual root → node edge for any visible node
  // that has no real edge, so everything hangs off `your_startup`. NOT written
  // to the DB — the real edge gets created only when the node is applied.
  const rootRow = parsedNodes.find((n) => n.node_type === 'your_startup');
  let rootId = rootRow?.id as string | undefined;
  // Older projects may lack a your_startup root — synthesize a virtual center
  // so every node (incl. pending proposals) visibly hangs off the project.
  if (!rootId) {
    rootId = `virt_root_${projectId}`;
    parsedNodes.unshift({
      id: rootId,
      project_id: projectId,
      name: projectName,
      node_type: 'your_startup',
      summary: '',
      attributes: {},
      reviewed_state: 'applied',
    });
  }
  const connected = new Set<string>();
  for (const e of realEdges) { connected.add(e.source as string); connected.add(e.target as string); }
  const virtualEdges: Array<Record<string, unknown>> = [];
  for (const n of parsedNodes) {
    const nid = n.id as string;
    if (nid === rootId || connected.has(nid)) continue;
    virtualEdges.push({
      id: `virt_${nid}`,
      source: rootId,
      target: nid,
      relation: 'belongs_to',
      label: null,
      weight: 0.5,
      virtual: true,
    });
  }

  return json({ nodes: parsedNodes, edges: [...realEdges, ...virtualEdges] });
}
