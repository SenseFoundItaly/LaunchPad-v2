import { NextRequest } from 'next/server';
import { get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { coerceJson } from '@/lib/jsonb';
import { generateNodeImportance } from '@/lib/node-importance-ai';

/**
 * POST /api/projects/{projectId}/node-importance  { node_id }
 *
 * Lazily generate + cache the AI "why this matters" sentence for a knowledge
 * node (NodeDetailPanel calls this on first view). Idempotent: returns the
 * cached value if present; generates once otherwise. Returns { importance: null }
 * when the NODE_IMPORTANCE_AI flag is off — the client then keeps the template.
 *
 * Route shape is `[projectId]/node-importance` (ONE dynamic + static leaf) on
 * purpose — the OpenNext adapter drops `[dyn]/…/[dyn]/<static>` routes in prod.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: { node_id?: string };
  try { body = await request.json(); } catch { return error('invalid JSON body'); }
  const nodeId = body?.node_id;
  if (!nodeId || typeof nodeId !== 'string') return error('node_id required');

  const node = await get<{
    id: string; name: string | null; node_type: string | null;
    summary: string | null; attributes: unknown; importance: string | null;
  }>(
    'SELECT id, name, node_type, summary, attributes, importance FROM graph_nodes WHERE id = ? AND project_id = ?',
    nodeId, projectId,
  );
  if (!node) return error('node not found', 404);

  // Already generated → return as-is (one-shot, never regenerate).
  if (node.importance) return json({ importance: node.importance });

  const importance = await generateNodeImportance(projectId, {
    name: node.name,
    node_type: node.node_type,
    summary: node.summary,
    attributes: coerceJson<Record<string, unknown>>(node.attributes),
  });

  if (importance) {
    await run('UPDATE graph_nodes SET importance = ? WHERE id = ? AND project_id = ?', importance, nodeId, projectId);
  }
  return json({ importance: importance ?? null });
}
