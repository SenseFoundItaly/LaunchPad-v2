-- Pricing department singleton state.
-- See db/migrations/007_pricing_state.sql for rationale.

CREATE TABLE IF NOT EXISTS pricing_state (
  project_id    VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  anchor_price  DOUBLE PRECISION,
  currency      VARCHAR(3) DEFAULT 'USD',
  tiers         JSONB DEFAULT '[]'::jsonb,
  wtp           JSONB DEFAULT '{}'::jsonb,
  unit_econ     JSONB DEFAULT '{}'::jsonb,
  model         VARCHAR,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
