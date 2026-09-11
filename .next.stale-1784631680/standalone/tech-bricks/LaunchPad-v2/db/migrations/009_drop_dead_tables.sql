-- ============================================================================
-- Migration 009 — Drop confirmed-dead tables
-- ============================================================================
-- Status: AUTHORIZED FOR APPLICATION. User approved on 2026-06-03 as part of
-- the "full cleanup" pass.
--
-- Scope: drop the 4 tables verified to have ZERO code references and ZERO
-- rows globally as of 2026-06-03. Each verified individually via grep
-- (INSERT/UPDATE/DELETE/SELECT FROM) + DB COUNT(*).
--
-- NOT included here (intentionally kept):
--   - The ~12 tables with code writers but 0 rows globally (e.g. milestones,
--     investors, fundraising_rounds). Those need code deletion FIRST before
--     the table can be dropped — covered by a future migration.
--   - The 6 side tables targeted by Phase 1 consolidation (ecosystem_alerts,
--     intelligence_briefs, source_changes, signal_activity_logs,
--     competitor_profiles, assumptions). Those wait for Phase 2 producer
--     migration to stabilise before drop.
--
-- Drop order respects FK chain: draft_versions → drafts, tool_executions
-- standalone. CASCADE used for belt-and-braces.
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS draft_versions  CASCADE;
DROP TABLE IF EXISTS drafts          CASCADE;
DROP TABLE IF EXISTS tool_executions CASCADE;
DROP TABLE IF EXISTS tools           CASCADE;

COMMIT;

-- End of 009.
