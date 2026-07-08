-- ============================================================================
-- 032: Build & Launch Hub — mvp_builds + mvp_build_feedback
-- ----------------------------------------------------------------------------
-- The dedicated "Build" section turns accumulated project intelligence into an
-- iterating MVP via a pluggable builder driver (e2b | v0 | lovable | replit).
--
--   mvp_builds          — one row per build iteration (versioned by `iteration`);
--                         "current build" for a project = the max iteration.
--   mvp_build_feedback  — comments/feedback that feed the NEXT iteration's prompt
--                         (founder notes, interviews, watcher signals, live-app
--                         diffs). `incorporated_in_iteration` NULL = still pending.
--
-- Purpose-built rather than overloading `published_assets` (Daytona-shaped, with a
-- slug UNIQUE that fights an iterating build and is counted by the Stage-5
-- something_shipped check). The generated prompt text also lives, optionally, in
-- build_artifacts (spec_artifact_id). Additive + idempotent. (The migrate
-- runner already wraps each file in a transaction — no explicit BEGIN/COMMIT.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mvp_builds (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lane VARCHAR NOT NULL DEFAULT 'product',          -- product | growth
  builder VARCHAR NOT NULL DEFAULT 'e2b',           -- e2b | v0 | lovable | replit | ploy
  substrate VARCHAR,                                -- webcontainer | e2b (build-your-own driver)
  builder_ref VARCHAR,                              -- driver handle: v0 chat/project id, or E2B sandbox id
  iteration INTEGER NOT NULL DEFAULT 1,
  status VARCHAR NOT NULL DEFAULT 'draft',          -- draft | building | live | superseded | failed
  spec_prompt TEXT,                                 -- the generated builder-ready prompt
  spec_artifact_id VARCHAR,                         -- optional pointer into build_artifacts(id)
  preview_url TEXT,                                 -- iframe target (sandbox port / chat.demo)
  live_app_url TEXT,                                -- deployed/persisted app URL
  watch_source_id VARCHAR,                          -- logical link to watch_sources(id) for live monitoring
  parent_build_id VARCHAR REFERENCES mvp_builds(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mvp_builds_project_iter
  ON mvp_builds(project_id, iteration DESC);

CREATE TABLE IF NOT EXISTS mvp_build_feedback (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  build_id VARCHAR REFERENCES mvp_builds(id) ON DELETE SET NULL,
  source VARCHAR NOT NULL DEFAULT 'founder',        -- founder | interview | watcher | memory_fact | live_monitor | brief | ploy
  source_ref_id VARCHAR,
  body TEXT NOT NULL,
  severity VARCHAR,                                 -- low | medium | high (optional)
  incorporated_in_iteration INTEGER,               -- NULL = pending (not yet folded into a build)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mvp_build_feedback_project_time
  ON mvp_build_feedback(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mvp_build_feedback_pending
  ON mvp_build_feedback(project_id, incorporated_in_iteration);
