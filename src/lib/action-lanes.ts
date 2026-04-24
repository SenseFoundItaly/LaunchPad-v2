/**
 * Action lane taxonomy — Phase 1 (Bucket Reorganization).
 *
 * Pure-function module. NO `@/lib/db` import — safe to consume from client
 * components (e.g. /project/[id]/actions/page.tsx). The earlier home for this
 * was `@/lib/pending-actions`, but that file imports better-sqlite3, which
 * blows up Turbopack's client bundle with `Module not found: Can't resolve 'fs'`.
 *
 * Server-side callers (API routes, cron) continue to import these symbols
 * from `@/lib/pending-actions` via re-export, so this split is invisible to
 * them.
 *
 * Lanes:
 *   - TODO:         things the founder DOES (action verbs: done/snooze/dismiss)
 *   - APPROVAL:     things the agent DRAFTED and the founder approves/edits/rejects
 *   - NOTIFICATION: things the system FINISHED that the founder just acknowledges
 *
 * Pure derivation from action_type — no schema column added. Default fallback
 * is 'approval' because the generic approve/edit/reject verbs work for any
 * unknown draft-like type.
 */

import type { PendingActionType } from '@/types';

export type ActionLane = 'todo' | 'approval' | 'notification';

export const ACTION_LANE: Record<PendingActionType, ActionLane> = {
  task: 'todo',
  skill_rerun_result: 'notification',
  configure_monitor: 'approval',
  configure_budget: 'approval',
  workflow_step: 'approval',
  draft_email: 'approval',
  draft_linkedin_post: 'approval',
  draft_linkedin_dm: 'approval',
  proposed_hypothesis: 'approval',
  proposed_interview_question: 'approval',
  proposed_landing_copy: 'approval',
  proposed_investor_followup: 'approval',
  proposed_graph_update: 'approval',
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
