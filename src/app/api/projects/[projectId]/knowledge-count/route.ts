import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { get } from '@/lib/db';
import { countAppliedKnowledge } from '@/lib/knowledge-count';

/**
 * GET /api/projects/{projectId}/knowledge-count
 *
 * Lightweight count powering the NavRail "Knowledge" badge. Returns the SAME
 * applied-knowledge total the Canvas "Knowledge" row shows (via
 * countAppliedKnowledge), so the sidebar and the canvas can never disagree.
 *
 * Auth: tryProjectAccess gate (same as /intelligence, /actions). memory_facts
 * are per-(user,project), so the count uses projects.owner_user_id — the same
 * viewer the intelligence panel resolves facts for.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const project = await get<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?',
    projectId,
  );
  const { total } = await countAppliedKnowledge(projectId, project?.owner_user_id ?? null);
  return json({ count: total });
}
