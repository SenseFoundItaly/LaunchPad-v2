-- ============================================================================
-- 016: create the assumptions table (schema drift)
-- ----------------------------------------------------------------------------
-- db/schema.sql has defined `assumptions` (line ~903) for a while, and shipped
-- code reads/writes it: the skill-executor's assumption linker, the
-- list_open_assumptions chat tool, the /assumptions page, and the inbox's
-- assumption_review materialization. But the table was never created in prod —
-- observed in the b8ac22f certification as a caught-but-noisy
--   [skill-executor] assumption linker failed: relation "assumptions" does not exist
-- on every skill approval, with the linker silently no-oping.
-- DDL below is copied verbatim from db/schema.sql. Additive + idempotent.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS assumptions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  category VARCHAR NOT NULL,
  text TEXT NOT NULL,
  source TEXT,
  explicit BOOLEAN DEFAULT false,
  criticality VARCHAR NOT NULL DEFAULT 'medium',
  status VARCHAR NOT NULL DEFAULT 'open',
  validated_by_skill_completion_id VARCHAR REFERENCES skill_completions(id) ON DELETE SET NULL,
  validated_at TIMESTAMP,
  invalidated_at TIMESTAMP,
  invalidated_reason TEXT,
  validation_evidence TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, number)
);

CREATE INDEX IF NOT EXISTS idx_assumptions_project_status
  ON assumptions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_assumptions_project_criticality
  ON assumptions(project_id, criticality, status);

COMMIT;
