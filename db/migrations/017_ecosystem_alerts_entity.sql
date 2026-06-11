-- ============================================================================
-- 017: persist the alert's subject entity on ecosystem_alerts
-- ----------------------------------------------------------------------------
-- The monitor-output artifact contract carries an `entity` field (the single
-- company/product the alert is about, e.g. "HelloFresh"). The parser validates
-- it and uses it for competitor_profiles at parse time — but it was never
-- persisted, so the knowledge-write executor (acceptAlertIntoKnowledge) had to
-- RE-DERIVE the name from the headline via entityNameFromHeadline(), whose
-- verb-list heuristic misses joins/selected/appoints/… → 2/3 signal-origin
-- graph_nodes were still named after the full event sentence.
-- Additive + idempotent. NULL for pre-wave alerts (consumers fall back to the
-- headline heuristic, old behavior).
-- ============================================================================

BEGIN;

ALTER TABLE ecosystem_alerts ADD COLUMN IF NOT EXISTS entity TEXT;

COMMENT ON COLUMN ecosystem_alerts.entity IS
  'Subject company/product the alert is about (from the artifact''s entity field, falling back to entityNameFromHeadline at insert). NULL on pre-017 rows — consumers fall back to the headline heuristic.';

COMMIT;
