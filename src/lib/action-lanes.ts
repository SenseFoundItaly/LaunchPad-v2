/**
 * Action lane taxonomy — Phase 1 (Bucket Reorganization).
 *
 * Pure-function module. NO `@/lib/db` import — safe to consume from client
 * components (e.g. /project/[id]/actions/page.tsx). The earlier home for this
 * was `@/lib/pending-actions`, but that file imports server-only DB code which
 * blows up Turbopack's client bundle.
 *
 * Server-side callers (API routes, cron) continue to import these symbols
 * from `@/lib/pending-actions` via re-export, so this split is invisible to
 * them.
 *
 * Lanes:
 *   - TODO:         things the founder DOES (action verbs: done/snooze/dismiss)
 *   - APPROVAL:     things the agent DRAFTED and the founder applies/edits/rejects
 *   - SIGNAL:       watcher findings — ecosystem alerts materialized as
 *                   signal_alert pending_actions. Own founder-facing "Signals"
 *                   tab with full pending / approved / rejected history plus
 *                   the watcher run log. Split out of APPROVAL because monitor
 *                   runs drop these in bursts and they drowned the drafts.
 *   - NOTIFICATION: things the system FINISHED that the founder just acknowledges
 *   - MONITOR:      active background watchers. NOT derived from pending_actions —
 *                   this lane reads from /monitors directly. We keep it inside
 *                   the lane vocabulary so the Inbox tab strip has one source
 *                   of truth, but the rendering branch on lane === 'monitor'
 *                   swaps out the data source.
 *
 * Pure derivation from action_type — no schema column added. Default fallback
 * is 'approval' because the generic apply/edit/reject verbs work for any
 * unknown draft-like type.
 */

import type { PendingActionType } from '@/types';

export type ActionLane = 'todo' | 'approval' | 'signal' | 'notification' | 'monitor';

export const ACTION_LANE: Record<PendingActionType, ActionLane> = {
  task: 'todo',
  skill_rerun_result: 'notification',
  configure_monitor: 'approval',
  configure_budget: 'approval',
  configure_watch_source: 'approval',
  run_skill: 'approval',
  workflow_step: 'approval',
  draft_email: 'approval',
  draft_linkedin_post: 'approval',
  draft_linkedin_dm: 'approval',
  proposed_hypothesis: 'approval',
  proposed_interview_question: 'approval',
  proposed_landing_copy: 'approval',
  proposed_investor_followup: 'approval',
  proposed_graph_update: 'approval',
  // Unified inbox surface — materialized from other proposal tables.
  //
  // signal_alert gets its OWN lane (history: notification → approval →
  // signal). Its apply executor (acceptAlertIntoKnowledge) files the finding
  // into the knowledge graph, so the founder is making a review decision —
  // but watcher runs drop these in bursts and they drowned the drafts in the
  // generic Approvals tab. The Signals tab shows the full pending / approved /
  // rejected history plus the watcher run log. It must NEVER go back to
  // 'notification': the cron stale-sweep (dismissStaleNotifications uses
  // typesForLane('notification')) would silently discard unreviewed signals
  // after 7 days without ever running the executor, and the only verb there
  // was "Acknowledge" (reject) — Accept was unreachable.
  signal_alert: 'signal',
  intelligence_brief: 'approval',
  assumption_review: 'approval',
};

export function laneFor(type: PendingActionType): ActionLane {
  return ACTION_LANE[type] ?? 'approval';
}

/** All action_types belonging to a lane — useful for SQL IN (...) filters. */
export function typesForLane(lane: ActionLane): PendingActionType[] {
  return (Object.keys(ACTION_LANE) as PendingActionType[]).filter(
    (t) => ACTION_LANE[t] === lane,
  );
}
