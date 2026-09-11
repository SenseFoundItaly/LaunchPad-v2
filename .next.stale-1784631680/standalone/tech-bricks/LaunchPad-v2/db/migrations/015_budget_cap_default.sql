-- ============================================================================
-- 015: align project_budgets LLM cap with schema truth ($5, not $0.30)
-- ----------------------------------------------------------------------------
-- DEPLOY-BLOCKER fix (cert 2026-06-10 on 639fb32). The prod column default for
-- project_budgets.cap_llm_usd was 0.30 (warn 0.24) — a schema drift; db/schema.sql
-- and src/lib/cost-meter.ts:122 ("Schema truth: cap_llm_usd=5.00") both intend 5.00.
-- New-project INSERT relies on the column default, so EVERY project capped at
-- $0.30 and starved the skill + autonomous layer after ~5 chat turns.
--
-- (a) fix the column default for future projects, and
-- (b) bump existing rows still on the wrong default to the intended values.
-- Additive + idempotent. current_llm_usd (spend history) is never touched.
-- ============================================================================

BEGIN;

-- (a) future projects
ALTER TABLE project_budgets ALTER COLUMN cap_llm_usd  SET DEFAULT 5.00;
ALTER TABLE project_budgets ALTER COLUMN warn_llm_usd SET DEFAULT 4.00;

-- (b) existing projects created under the wrong default ($0.30 / $0.24)
UPDATE project_budgets SET cap_llm_usd  = 5.00 WHERE cap_llm_usd  = 0.30;
UPDATE project_budgets SET warn_llm_usd = 4.00 WHERE warn_llm_usd = 0.24;

COMMIT;
