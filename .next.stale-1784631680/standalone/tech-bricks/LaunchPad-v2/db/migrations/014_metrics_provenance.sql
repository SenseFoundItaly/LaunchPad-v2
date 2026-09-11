-- ============================================================================
-- 014: metric provenance tier
-- ----------------------------------------------------------------------------
-- User directive (2026-06-10): founder-asserted numbers must not render like
-- measured facts. v1 of provenance tiers: metrics carry where the number came
-- from — 'founder_asserted' (chat claim, the update_metrics default),
-- 'workflow_derived' (produced by an executed workflow/skill), or, later,
-- externally verified. The UI shows a "self-reported" pill for unverified
-- values; the journey/metrics surfaces can filter or discount by tier.
-- Additive + nullable + idempotent. NULL = legacy rows of unknown provenance
-- (treated as self-reported by the renderer).
-- ============================================================================

BEGIN;

ALTER TABLE metrics ADD COLUMN IF NOT EXISTS provenance TEXT;

COMMIT;
