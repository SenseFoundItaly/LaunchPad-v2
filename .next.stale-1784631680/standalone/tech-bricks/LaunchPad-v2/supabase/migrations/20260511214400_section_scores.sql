-- Add section_scores JSONB column to skill_completions.
-- Stores per-dimension scores (normalized 0-10) extracted from skill output.
-- Shape: { "market_opportunity": 7.2, "competitive_landscape": 5.5, ... }
-- Nullable — null means fall back to skill total score.

ALTER TABLE skill_completions ADD COLUMN IF NOT EXISTS section_scores JSONB;
