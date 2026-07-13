-- Score history (2026-07-13) — the `scores` table is a single overwrite-in-place
-- row, so a founder could never see "my score went 5.2 → 7.1 over three weeks."
-- Append-only log: one row per real (>0) scoring, so the trajectory is durable.
-- Additive; safe on prod.
CREATE TABLE IF NOT EXISTS score_history (
  id             VARCHAR PRIMARY KEY,
  project_id     VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  overall_score  DOUBLE PRECISION NOT NULL,
  recommendation TEXT,
  source         VARCHAR,          -- 'startup-scoring' | 'gauge-chart' | …
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_score_history_project_time ON score_history(project_id, created_at DESC);
