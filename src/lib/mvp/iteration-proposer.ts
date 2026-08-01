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
import { listOpenIssues, pickTopCluster, clusterReady } from './build-issues';
import { driverOpCostUsd } from './build-costs';

export async function maybeProposeMvpIteration(projectId: string): Promise<boolean> {
  // Iterate the latest LIVE build — NOT the highest-iteration row. A failed newest
  // iteration must not dead-end the loop: we keep proposing against the last good
  // version while the feedback that motivated the failed attempt stays pending.
  const build = await getLatestLiveBuild(projectId);
  if (!build) return false;

  const open = await get<{ id: string }>(
    `SELECT id FROM pending_actions
       WHERE project_id = ? AND action_type = 'mvp_build_iteration'
         AND status IN ('pending', 'edited')
       LIMIT 1`,
    projectId,
  );
  if (open) return false;

  // Preferred path (#270): propose ONE feature-shaped cluster of deduped
  // issues, with the changeset spelled out so the founder approves a legible
  // plan. Falls back to raw pending feedback when no issues exist (classifier
  // fail-open, or pre-037 rows).
  const cost = driverOpCostUsd(build.builder);
  const priceLine = cost > 0 ? ` Estimated cost: ~$${cost.toFixed(2)} build credit.` : '';

  const issues = await listOpenIssues(projectId);
  const cluster = pickTopCluster(issues);
  let title: string;
  let rationale: string;
  let payload: Record<string, unknown>;
  let count: number;

  if (cluster) {
    // Batching threshold (#271): only spend a credit when the cluster is worth it.
    if (!clusterReady(cluster, Date.now())) return false;
    const lines = cluster.issues
      .slice(0, 8)
      .map((i) => `• ${i.title}${i.evidence_count > 1 ? ` (${i.evidence_count} signals)` : ''}`)
      .join('\n');
    title = `Ship ${cluster.feature}: ${cluster.issues.length} improvement(s) (v${build.iteration} → v${build.iteration + 1})`;
    rationale = `${lines}\nApprove to implement these in the next build iteration.${priceLine}`;
    payload = {
      build_id: build.id,
      agent: 'builder',
      feature: cluster.feature,
      issue_ids: cluster.issues.map((i) => i.id),
      changeset: cluster.issues.map((i) => i.title),
    };
    count = cluster.issues.length;
  } else {
    const pending = await listPendingFeedback(projectId);
    if (pending.length === 0) return false;
    // Raw-feedback batching: ≥2 items, any high, or the oldest waited a week.
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const ready =
      pending.length >= 2 ||
      pending.some((f) => f.severity === 'high') ||
      pending.some((f) => new Date(f.created_at).getTime() <= weekAgo);
    if (!ready) return false;
    title = `Iterate MVP build (v${build.iteration} → v${build.iteration + 1})`;
    rationale = `${pending.length} new feedback item(s) since the last build — approve to generate the next iteration.${priceLine}`;
    payload = { build_id: build.id, agent: 'builder' };
    count = pending.length;
  }

  const pa = await createPendingAction({
    project_id: projectId,
    action_type: 'mvp_build_iteration',
    title,
    rationale,
    estimated_impact: 'medium',
    priority: cluster?.anyHigh ? 'high' : 'medium',
    payload,
  });
  // Nanocorp P1: decision-request voice — the Builder asks in the chat.
  const { postAgentUpdate } = await import('@/lib/agents/narrate');
  await postAgentUpdate(projectId, 'builder',
    { key: 'agent.iterate-due', params: { count, version: build.iteration } },
    { dedupeKey: `iterprop:${pa.id}`, pane: 'build', priority: 'must' });
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
