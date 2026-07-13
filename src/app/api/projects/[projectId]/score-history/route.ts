import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { AuthError } from '@/lib/auth/require-user';
import { requireProjectAccess } from '@/lib/auth/require-project-access';
import { getScoreHistory } from '@/lib/score-history';

/**
 * GET /api/projects/{projectId}/score-history
 * The startup-score trajectory (oldest→newest) — a durable time series over the
 * single-row `scores` snapshot, for a sparkline / "score up N since last week".
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  try {
    await requireProjectAccess(projectId);
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }
  const points = await getScoreHistory(projectId);
  const first = points[0]?.overall_score ?? null;
  const last = points[points.length - 1]?.overall_score ?? null;
  return json({
    points,
    count: points.length,
    delta: first !== null && last !== null ? Math.round((last - first) * 10) / 10 : null,
  });
}
