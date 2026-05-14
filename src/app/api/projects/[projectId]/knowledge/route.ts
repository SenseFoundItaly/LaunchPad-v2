import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';

interface KnowledgeItem {
  id: string;
  type: 'fact' | 'graph_node' | 'tabular_review';
  title: string;
  detail: string | null;
  kind: string | null;
  reviewed_state: string;
  created_at: string;
}

/**
 * GET /api/projects/{projectId}/knowledge?state=pending
 *
 * Lists knowledge items across memory_facts, graph_nodes, and tabular_reviews.
 * Default filter: state=pending (the founder's review inbox).
 * Pass state=all to see everything.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId } = await params;
  const stateParam = request.nextUrl.searchParams.get('state') || 'pending';

  const stateFilter = stateParam === 'all'
    ? ''
    : ` AND reviewed_state = '${stateParam === 'applied' ? 'applied' : stateParam === 'rejected' ? 'rejected' : 'pending'}'`;

  // Query all three tables in parallel
  const [facts, nodes, reviews] = await Promise.all([
    query<{ id: string; fact: string; kind: string; reviewed_state: string; created_at: string }>(
      `SELECT id, fact, kind, reviewed_state, created_at
       FROM memory_facts
       WHERE project_id = ? AND user_id = ?${stateFilter}
       ORDER BY created_at DESC
       LIMIT 50`,
      projectId, userId,
    ),
    query<{ id: string; name: string; node_type: string; summary: string | null; reviewed_state: string; created_at: string }>(
      `SELECT id, name, node_type, summary, reviewed_state, created_at
       FROM graph_nodes
       WHERE project_id = ?${stateFilter}
       ORDER BY created_at DESC
       LIMIT 50`,
      projectId,
    ),
    query<{ id: string; title: string; reviewed_state: string; created_at: string }>(
      `SELECT id, title, reviewed_state, created_at
       FROM tabular_reviews
       WHERE project_id = ?${stateFilter}
       ORDER BY created_at DESC
       LIMIT 20`,
      projectId,
    ),
  ]);

  const items: KnowledgeItem[] = [
    ...facts.map((f) => ({
      id: f.id,
      type: 'fact' as const,
      title: f.fact.slice(0, 120),
      detail: f.fact.length > 120 ? f.fact : null,
      kind: f.kind,
      reviewed_state: f.reviewed_state,
      created_at: f.created_at,
    })),
    ...nodes.map((n) => ({
      id: n.id,
      type: 'graph_node' as const,
      title: n.name,
      detail: n.summary,
      kind: n.node_type,
      reviewed_state: n.reviewed_state,
      created_at: n.created_at,
    })),
    ...reviews.map((r) => ({
      id: r.id,
      type: 'tabular_review' as const,
      title: r.title,
      detail: null,
      kind: 'review',
      reviewed_state: r.reviewed_state,
      created_at: r.created_at,
    })),
  ];

  // Sort all items by created_at descending
  items.sort((a, b) => b.created_at.localeCompare(a.created_at));

  // Count pending across all tables
  const pendingCount = items.filter((i) => i.reviewed_state === 'pending').length;

  return json({ items, pending_count: pendingCount });
}
