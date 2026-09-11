-- =============================================================================
-- Migration: Capability Upgrades (Epics 1, 2, 4)
--
-- Epic 1 — Citation Grammar v1: prose-level citations on chat_messages
-- Epic 2 — Tabular Reviews: structured comparison reviews with typed cells
-- Epic 4 — BYOK: per-user API key storage and model preference
--
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- Safe to run multiple times.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Epic 1: Citations JSONB column on chat_messages
-- ---------------------------------------------------------------------------
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS citations JSONB;

-- ---------------------------------------------------------------------------
-- Epic 2: Tabular Reviews + Cells
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tabular_reviews (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR NOT NULL,
  columns JSONB NOT NULL,
  column_types JSONB NOT NULL,
  sources JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tabular_reviews_project
  ON tabular_reviews(project_id);

CREATE TABLE IF NOT EXISTS tabular_cells (
  id VARCHAR PRIMARY KEY,
  review_id VARCHAR NOT NULL REFERENCES tabular_reviews(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  row_label VARCHAR NOT NULL,
  values JSONB NOT NULL,
  entity_id VARCHAR,
  entity_type VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tabular_cells_review
  ON tabular_cells(review_id, row_index);

-- ---------------------------------------------------------------------------
-- Epic 4: BYOK — user_api_keys table + preferred_model on users
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_model VARCHAR;

CREATE TABLE IF NOT EXISTS user_api_keys (
  id VARCHAR PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR NOT NULL,
  label VARCHAR NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_hint VARCHAR NOT NULL,
  validated_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_api_keys_user
  ON user_api_keys(user_id);
