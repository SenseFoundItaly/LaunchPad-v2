-- ============================================================================
-- 009: allow the `run_skill` pending_action type
-- ----------------------------------------------------------------------------
-- Architecture C (real-time, approve-first skills): the chat agent PROPOSES a
-- skill by creating a pending_action(action_type='run_skill'); the founder
-- approves (cost shown) and the run_skill executor runs it real-time via
-- runSkill. Migration 008 locked action_type to a CHECK union that predates
-- run_skill, so the INSERT failed with a constraint violation. Widen the union
-- by one value. Additive + non-destructive (no rows change, no columns drop).
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
    'run_skill'
  ));

COMMIT;
