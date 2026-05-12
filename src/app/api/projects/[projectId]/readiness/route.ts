import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
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
    return error('Failed to compute readiness', 500);
  }
}
