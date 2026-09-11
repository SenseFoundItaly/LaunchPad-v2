-- Gap C (2026-07-13): chat artifact retrievability.
-- The analysis/deliverable cards the agent renders inline in chat (risk-matrix,
-- comparison-table, tam-sam-som, persona-card, metric-grid, charts, insight-card…)
-- lived ONLY inside chat_messages.content — unreachable once the founder scrolled
-- past them (the Data Room showed 0 of them; Playwright-confirmed). This persists
-- each as a first-class row so the Data Room can list + re-render them.
-- Additive only — safe to run against prod.
CREATE TABLE IF NOT EXISTS chat_artifacts (
  id               VARCHAR PRIMARY KEY,
  project_id       VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chat_message_id  VARCHAR,                     -- the assistant message it came from (nullable)
  artifact_type    VARCHAR NOT NULL,
  title            VARCHAR,
  payload          JSONB NOT NULL,              -- the full artifact object, for re-render
  sources          JSONB NOT NULL DEFAULT '[]',
  turn_preview     VARCHAR,                     -- the founder ask that produced it (context)
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_artifacts_project_time ON chat_artifacts(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_artifacts_project_type ON chat_artifacts(project_id, artifact_type);
