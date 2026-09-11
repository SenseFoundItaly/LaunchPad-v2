-- ============================================================================
-- 023: allow the `edit_monitor` + `delete_monitor` pending_action types
-- ----------------------------------------------------------------------------
-- Agent project-accessibility (2026-06-19): the co-pilot can READ watchers
-- (list_watchers) but had no way to EDIT or DELETE an existing one. Following
-- the established propose→approve safety model, the agent now stages an edit or
-- a delete/pause as a pending_action the founder confirms in the Approvals lane:
--   - edit_monitor   → editMonitor executor (UPDATE schedule/objective/status,
--                       rebuilding the scan prompt when the objective changes)
--   - delete_monitor → deleteMonitor executor (pause = status='paused', or a
--                       hard delete when mode='delete')
-- The agent NEVER mutates a watcher directly; the founder's Apply is the gate.
--
-- pending_actions.action_type carries a CHECK union (last widened in 020), so an
-- INSERT of either new type would fail the constraint. Widen by two values.
-- Additive + non-destructive: no rows change, no columns drop; the
-- DROP ... IF EXISTS / ADD pair is safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE pending_actions
  DROP CONSTRAINT IF EXISTS pending_actions_action_type_check;
ALTER TABLE pending_actions
  ADD CONSTRAINT pending_actions_action_type_check
  CHECK (action_type IN (
    'draft_email', 'draft_linkedin_post', 'draft_linkedin_dm',
    'proposed_hypothesis', 'proposed_interview_question', 'proposed_landing_copy',
    'proposed_investor_followup', 'proposed_graph_update',
    'workflow_step', 'configure_monitor', 'configure_budget',
    'configure_watch_source', 'skill_rerun_result', 'task',
    'signal_alert', 'intelligence_brief', 'assumption_review', 'raw_change',
    'run_skill',
    'validation_proposal',
    'edit_monitor', 'delete_monitor'
  ));

COMMIT;
