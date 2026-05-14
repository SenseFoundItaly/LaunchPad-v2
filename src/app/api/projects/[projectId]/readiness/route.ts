import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { getStageReadiness } from '@/lib/stage-readiness';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

/** GET /api/projects/[projectId]/readiness
 *  Returns full ProjectReadiness including per-stage section scores. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  try {
    const readiness = await getStageReadiness(projectId);
    return json(readiness);
  } catch (err) {
    console.error('[readiness] getStageReadiness failed:', (err as Error).message);
    // Return a valid zeroed payload so the dashboard renders a meaningful
    // state instead of showing an infinite "Loading readiness…" spinner.
    // _fallback lets clients distinguish this from a real zero-score result.
    return json({
      overall_score: 0,
      overall_verdict: 'NOT READY',
      stages: [],
      next_recommended_skill: null,
      _fallback: true,
    });
  }
}
