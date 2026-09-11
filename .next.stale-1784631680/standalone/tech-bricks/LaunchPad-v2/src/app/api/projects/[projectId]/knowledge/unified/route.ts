import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { getProjectKnowledge } from '@/lib/knowledge/unified';

/**
 * GET /api/projects/{projectId}/knowledge/unified
 *
 * The single "what this project knows" read-layer. Aggregates the fragmented
 * producer stores (graph_nodes, memory_facts, ecosystem_alerts,
 * intelligence_briefs, competitor_profiles, interviews) into one normalized,
 * deduplicated, provenance-tagged list. Read-only.
 *
 * Auth: tryProjectAccess gate (same as /intelligence, /actions, /tasks).
 * Project scope is additionally enforced by `WHERE project_id = ?` in every
 * underlying store query.
 *
 * Response: { items: KnowledgeItem[], summary: { total, byKind, byProvenanceTier } }
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const { items, summary } = await getProjectKnowledge(projectId);
  return json({ items, summary });
}
