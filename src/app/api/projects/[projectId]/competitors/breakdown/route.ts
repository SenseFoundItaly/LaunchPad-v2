import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { readCompetitorMatryoshka } from '@/lib/competitor-categories';

/**
 * GET /api/projects/{projectId}/competitors/breakdown
 *
 * The competitor "matryoshka" (changelog item 14): each competitor node with its
 * categories nested (startup → competitor → category → detail). Includes pending
 * (dashed) competitors so the founder can review them off the graph. Separate
 * from the flat /competitors list (which feeds the watcher/profile surfaces).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const competitors = await readCompetitorMatryoshka(projectId);
  return json({ competitors });
}
