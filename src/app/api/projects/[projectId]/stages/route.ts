import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
// Note: `@/lib/stages` is the legacy pipeline-skill module — for the
// founder-journey evaluator we use `@/lib/journey`.
import { buildProjectSnapshot, evaluateAllStages, activeStage } from '@/lib/journey';

/**
 * GET /api/projects/{projectId}/stages
 *
 * Returns the 7 stage evaluations against the current project snapshot.
 * Each evaluation includes per-check verdicts with evidence/gap strings —
 * everything the StageCard UI needs without follow-up requests.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const snapshot = await buildProjectSnapshot(projectId);
  const evaluations = evaluateAllStages(snapshot);
  const active = activeStage(evaluations);

  return json({
    active_stage_id: active.stage.id,
    active_stage_number: active.stage.number,
    evaluations,
  });
}
