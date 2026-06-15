-- ============================================================================
-- 021: per-USER credit pool (founder decision 2026-06-14)
-- ----------------------------------------------------------------------------
-- Credits were per-project (project_budgets). They are now per USER: one
-- monthly pool shared across all of a user's projects. This adds the
-- authoritative pool table and backfills it by rolling up each user's existing
-- per-project spend for the current/past months, so nobody's live balance
-- resets on cutover.
--
-- project_budgets is intentionally LEFT IN PLACE for per-project dollar
-- observability (the usage page reads llm_usage_logs / project_budgets); it no
-- longer gates credits or the cap. cap/credits/cap-checks now read user_budgets.
--
-- New default: 100 credits over $1.00 LLM spend (was 500 / $5 per project).
-- Additive + idempotent. Spend history (current_llm_usd) is preserved, not reset.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS user_budgets (
  id VARCHAR PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_month VARCHAR NOT NULL,
  cap_llm_usd DOUBLE PRECISION DEFAULT 1.00,
  warn_llm_usd DOUBLE PRECISION DEFAULT 0.80,
  current_llm_usd DOUBLE PRECISION DEFAULT 0,
  cap_credits INTEGER DEFAULT 100,
  status VARCHAR DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_user_budgets_user_period
  ON user_budgets(user_id, period_month);

-- Backfill: sum each owner's per-project spend into their user pool, per month.
-- Deterministic id (md5 of user_id+period) keeps this idempotent on re-run.
INSERT INTO user_budgets
  (id, user_id, period_month, current_llm_usd, cap_llm_usd, warn_llm_usd, cap_credits, status)
SELECT
  'ubud_' || substr(md5(p.owner_user_id || pb.period_month), 1, 12),
  p.owner_user_id,
  pb.period_month,
  SUM(pb.current_llm_usd),
  1.00, 0.80, 100, 'active'
FROM project_budgets pb
JOIN projects p ON p.id = pb.project_id
WHERE p.owner_user_id IS NOT NULL
GROUP BY p.owner_user_id, pb.period_month
ON CONFLICT (user_id, period_month) DO UPDATE SET
  current_llm_usd = EXCLUDED.current_llm_usd,
  updated_at = CURRENT_TIMESTAMP;

COMMIT;
