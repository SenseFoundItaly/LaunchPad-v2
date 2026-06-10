-- ============================================================================
-- 013: add the journey-evidence columns the S5/S7 gates + snapshot expect
-- ----------------------------------------------------------------------------
-- Schema drift: stage-5-mvp.ts reads workflow.status + workflow.current_step,
-- stage-7-growth.ts reads metrics.current_value + fundraising_rounds.status, and
-- snapshot.ts SELECTs all of these — but prod's `workflow` (gtm_strategy/pitch_deck/…),
-- `metrics` (name/type/target_growth_rate) and `fundraising_rounds`
-- (round_type/target_amount/status) never had them. Result: the snapshot query
-- erred (500 when unguarded) and the workflow_active / scope_defined /
-- metrics_tracked / capital_plan gates could never close, and the new chat writer
-- tools (update_workflow / update_metrics / log_fundraising) wrote phantom columns.
--
-- Additive + nullable + idempotent (IF NOT EXISTS). No data changes. Safe to
-- re-run. Drop the columns to revert if the gate design is re-pointed instead.
-- ============================================================================

BEGIN;

ALTER TABLE workflow            ADD COLUMN IF NOT EXISTS status        TEXT;
ALTER TABLE workflow            ADD COLUMN IF NOT EXISTS current_step  TEXT;
ALTER TABLE metrics             ADD COLUMN IF NOT EXISTS current_value DOUBLE PRECISION;
ALTER TABLE fundraising_rounds  ADD COLUMN IF NOT EXISTS raised_amount DOUBLE PRECISION;

COMMIT;
