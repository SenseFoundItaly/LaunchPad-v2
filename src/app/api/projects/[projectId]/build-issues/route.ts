import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { query, get } from '@/lib/db';

/**
 * GET /api/projects/{projectId}/build-issues
 *
 * The founder-facing READ of the build backlog: features → issues → evidence,
 * plus whether a change proposal is waiting in the Inbox. This is what makes
 * the agent's understanding legible ("2 people told you pricing is hidden →
 * queued under Navigation") instead of living only in the database.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  // Open work first (evidence-weighted), then the most recently shipped — the
  // shipped tail is the "look what we did" record that makes progress visible.
  const issues = await query<{
    id: string;
    feature: string;
    title: string;
    severity: string | null;
    status: string;
    evidence_count: number;
    shipped_in_iteration: number | null;
  }>(
    `SELECT id, feature, title, severity, status, evidence_count, shipped_in_iteration
       FROM mvp_build_issues
      WHERE project_id = ?
        AND (status IN ('open', 'planned') OR shipped_in_iteration IS NOT NULL)
      ORDER BY (status IN ('open','planned')) DESC, evidence_count DESC, created_at ASC
      LIMIT 60`,
    projectId,
  );

  // Unclassified evidence (classifier fail-open or pre-issue rows) — still
  // pending, still counts toward the next iteration, so surface the count.
  const loose = await get<{ n: number }>(
    `SELECT count(*)::int AS n FROM mvp_build_feedback
      WHERE project_id = ? AND incorporated_in_iteration IS NULL AND issue_id IS NULL`,
    projectId,
  );

  const proposal = await get<{ id: string; title: string }>(
    `SELECT id, title FROM pending_actions
      WHERE project_id = ? AND action_type = 'mvp_build_iteration'
        AND status IN ('pending', 'edited')
      ORDER BY created_at DESC LIMIT 1`,
    projectId,
  );

  return json({
    issues,
    unclassified_pending: loose?.n ?? 0,
    open_proposal: proposal ? { id: proposal.id, title: proposal.title } : null,
  });
}
