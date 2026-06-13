-- ============================================================================
-- 020: allow the `validation_proposal` pending_action type
-- ----------------------------------------------------------------------------
-- Validation gate (founder directive 2026-06-12): nothing turns a spine substep
-- green without the founder's explicit yes. The chat agent (and the upload
-- extractor) PROPOSE a batch of validation evidence — canvas fields, mapped
-- competitors, market sizing — by creating a pending_action
-- (action_type='validation_proposal'); the founder reviews the batch (per-item
-- remove/edit, combined credit cost) and approves which items commit to the
-- spine via the applyValidationProposal executor.
--
-- Migration 009 locked action_type to a CHECK union that predates this type, so
-- the INSERT would fail with a constraint violation. Widen the union by one
-- value. Additive + non-destructive: no rows change, no columns drop, and the
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
    'validation_proposal'
  ));

COMMIT;
