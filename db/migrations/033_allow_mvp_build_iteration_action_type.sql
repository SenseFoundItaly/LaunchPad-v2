-- ============================================================================
-- 033: allow the 'mvp_build_iteration' pending_action type
-- ----------------------------------------------------------------------------
-- The Build & Launch Hub auto-drafts the NEXT iteration's build prompt into the
-- Inbox as a founder-gated pending_action. A new action_type needs BOTH the TS
-- union (src/types/index.ts) AND this CHECK constraint (a missing CHECK silently
-- rejects inserts). Postgres has no ALTER ... ADD VALUE for CHECK lists — drop +
-- re-add the full list (copied from migration 025) plus the new value.
-- ============================================================================

ALTER TABLE pending_actions DROP CONSTRAINT IF EXISTS pending_actions_action_type_check;

ALTER TABLE pending_actions ADD CONSTRAINT pending_actions_action_type_check CHECK (
  action_type IN (
    'draft_email',
    'draft_linkedin_post',
    'draft_linkedin_dm',
    'proposed_hypothesis',
    'proposed_interview_question',
    'proposed_landing_copy',
    'proposed_investor_followup',
    'proposed_graph_update',
    'workflow_step',
    'configure_monitor',
    'edit_monitor',
    'delete_monitor',
    'configure_budget',
    'configure_watch_source',
    'run_skill',
    'skill_rerun_result',
    'validation_proposal',
    'task',
    'signal_alert',
    'intelligence_brief',
    'assumption_review',
    'raw_change',
    'propose_assumption_revision',
    'mvp_build_iteration'          -- NEW: Build Hub auto-iteration proposal
  )
);
