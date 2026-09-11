-- Wave 2 (ephemeral-gap fixes 2026-07-12)
-- Additive only — safe to run against prod (CREATE TABLE IF NOT EXISTS).

-- Gap 2: research cache. Web-search / url-read results were never persisted —
-- they lived only in the ephemeral pi-agent session file, so every turn
-- re-fetched identical queries (cost) and un-folded evidence was unrecoverable.
-- Cache is GLOBAL (a web result is project-agnostic) keyed by sha1(tool:key).
CREATE TABLE IF NOT EXISTS research_cache (
  id           VARCHAR PRIMARY KEY,          -- sha1(tool:normalized_key)
  tool         VARCHAR NOT NULL,             -- 'web_search' | 'read_url'
  cache_key    VARCHAR NOT NULL,             -- normalized query or url (for debugging)
  result_text  TEXT NOT NULL,                -- the tool's markdown result the agent saw
  sources      JSONB NOT NULL DEFAULT '[]',  -- structured Source[]
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at   TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_cache_expiry ON research_cache(expires_at);

-- Gap 5: stage transition history. The 7-stage journey is recomputed every turn
-- (single source of truth) and NEVER persisted, so there is no "when did Stage 1
-- close?" / week-over-week diff. Append-only; the evaluator stays pure — the
-- write lives in the caller (recordStageTransitions) and only inserts on a
-- verdict change.
CREATE TABLE IF NOT EXISTS stage_events (
  id            VARCHAR PRIMARY KEY,
  project_id    VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id      VARCHAR NOT NULL,
  stage_number  INTEGER,
  check_id      VARCHAR,                     -- NULL = a whole-stage verdict transition
  from_status   VARCHAR,                     -- NULL when first observed
  to_status     VARCHAR NOT NULL,
  occurred_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stage_events_project_time ON stage_events(project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_events_project_check ON stage_events(project_id, check_id);
