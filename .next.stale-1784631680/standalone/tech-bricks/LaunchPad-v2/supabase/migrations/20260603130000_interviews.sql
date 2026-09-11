-- Structured customer/user interviews.
-- See db/migrations/008_interviews.sql for rationale.

CREATE TABLE IF NOT EXISTS interviews (
  id              TEXT PRIMARY KEY,
  project_id      VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  person_name     TEXT NOT NULL,
  person_role     TEXT,
  person_segment  TEXT,
  conducted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  channel         TEXT,
  summary         TEXT NOT NULL,
  top_pain        TEXT,
  urgency         TEXT,
  wtp_amount      DOUBLE PRECISION,
  wtp_currency    VARCHAR(3) DEFAULT 'USD',
  meta            JSONB DEFAULT '{}'::jsonb,
  sources         JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interviews_project_conducted
  ON interviews(project_id, conducted_at DESC);
