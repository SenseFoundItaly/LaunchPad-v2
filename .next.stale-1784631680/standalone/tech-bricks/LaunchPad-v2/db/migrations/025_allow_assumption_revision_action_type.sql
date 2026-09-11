-- Phase B (financial coherence): a watcher signal can propose a revision to a
-- financial assumption (e.g. a competitor's price → review your ARPU). The
-- proposal lands as a founder-gated pending_action; applying it recomputes the
-- model. A new action_type needs BOTH the TS union AND this CHECK constraint
-- (a missing CHECK silently rejects inserts).
--
-- Rebuild the pending_actions.action_type CHECK to add 'propose_assumption_revision'.
-- (Postgres has no ALTER ... ADD VALUE for CHECK lists — drop + re-add.)

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
    'raw_change',                 -- retired from the TS union but kept in the DB for any legacy rows
    'propose_assumption_revision' -- NEW (Phase B): watcher-proposed financial assumption revision
  )
);
