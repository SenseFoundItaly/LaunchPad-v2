// ============================================================================
// Auto-iteration proposer — cron-safe and LLM-free.
//
// When a project's current build is LIVE and there is new (not-yet-incorporated)
// feedback, draft ONE `mvp_build_iteration` pending_action for founder approval.
// The expensive part (generating the delta prompt + running the driver) happens
// only on APPROVE, in the executor. Naturally idempotent: approving folds the
// feedback in (pending list empties) and we never queue a second while one is open.
// ============================================================================

import { get, query } from '@/lib/db';
import { createPendingAction } from '@/lib/pending-actions';
import { getLatestLiveBuild, listPendingFeedback } from './mvp-builds';

export async function maybeProposeMvpIteration(projectId: string): Promise<boolean> {
  // Iterate the latest LIVE build — NOT the highest-iteration row. A failed newest
  // iteration must not dead-end the loop: we keep proposing against the last good
  // version while the feedback that motivated the failed attempt stays pending.
  const build = await getLatestLiveBuild(projectId);
  if (!build) return false;

  const pending = await listPendingFeedback(projectId);
  if (pending.length === 0) return false;

  const open = await get<{ id: string }>(
    `SELECT id FROM pending_actions
       WHERE project_id = ? AND action_type = 'mvp_build_iteration'
         AND status IN ('pending', 'edited')
       LIMIT 1`,
    projectId,
  );
  if (open) return false;

  await createPendingAction({
    project_id: projectId,
    action_type: 'mvp_build_iteration',
    title: `Iterate MVP build (v${build.iteration} → v${build.iteration + 1})`,
    rationale: `${pending.length} new feedback item(s) since the last build — approve to generate the next iteration.`,
    estimated_impact: 'medium',
    priority: 'medium',
    payload: { build_id: build.id },
  });
  return true;
}

/**
 * Cron sweep: propose iterations for every project that has a live build AND
 * pending feedback. Cheap, SELECT-driven, bounded.
 */
export async function proposeMvpIterationsCron(limit = 20): Promise<number> {
  const rows = await query<{ project_id: string }>(
    `SELECT DISTINCT b.project_id
       FROM mvp_builds b
       JOIN mvp_build_feedback f
         ON f.project_id = b.project_id AND f.incorporated_in_iteration IS NULL
      WHERE b.status = 'live'
      LIMIT ?`,
    limit,
  );
  let proposed = 0;
  for (const r of rows) {
    try {
      if (await maybeProposeMvpIteration(r.project_id)) proposed++;
    } catch (err) {
      console.warn('[cron] maybeProposeMvpIteration failed:', (err as Error).message);
    }
  }
  return proposed;
}
