-- ============================================================================
-- 037: Build Hub issue/feature backlog layer (evidence → issue → feature)
-- ----------------------------------------------------------------------------
-- Raw mvp_build_feedback rows are EVIDENCE, not the plan. They roll up into
-- deduped ISSUES ("add plan toggle"), grouped under stable FEATURE labels
-- ("Pricing") — so iterations become feature-shaped ("Ship Pricing: 2 issues")
-- and repeated signals raise an issue's priority via evidence_count instead of
-- duplicating bullets. Features are plain text labels (normalized by the
-- intake classifier), deliberately NOT a table — promote only if founders
-- ever need to rename/reorder them. GitHub issue #267.
-- ============================================================================

CREATE TABLE IF NOT EXISTS mvp_build_issues (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature VARCHAR NOT NULL DEFAULT 'General',   -- normalized label ("Pricing", "Onboarding")
  title VARCHAR NOT NULL,                       -- actionable: "add a plan toggle"
  severity VARCHAR,                             -- low | medium | high (max of evidence)
  status VARCHAR NOT NULL DEFAULT 'open',       -- open | planned | shipped | wontfix
  evidence_count INTEGER NOT NULL DEFAULT 0,    -- linked feedback rows (priority signal)
  shipped_in_iteration INTEGER,                 -- set when the implementing build settles live
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mvp_build_issues_project_status
  ON mvp_build_issues(project_id, status);

-- Evidence link: a feedback row belongs to at most one issue. ON DELETE SET
-- NULL so deleting an issue returns its evidence to the unclassified pool.
ALTER TABLE mvp_build_feedback
  ADD COLUMN IF NOT EXISTS issue_id VARCHAR REFERENCES mvp_build_issues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mvp_build_feedback_issue
  ON mvp_build_feedback(issue_id) WHERE issue_id IS NOT NULL;
