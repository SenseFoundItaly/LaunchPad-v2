-- Migration 004: Add per-project settings JSONB column
-- Keys: rich_context (bool) — enables enriched agent context with rationale, labels, scores
ALTER TABLE projects ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
COMMENT ON COLUMN projects.settings IS 'Per-project settings. Keys: rich_context (bool)';
