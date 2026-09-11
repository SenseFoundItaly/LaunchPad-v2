-- Adds indexes on project_id and other FK columns used in common query
-- patterns but missing from the original schema.
-- All CREATE INDEX IF NOT EXISTS — safe to re-run.

-- investors: queried by project_id on dashboard + fundraising pages
CREATE INDEX IF NOT EXISTS idx_investors_project
  ON investors(project_id);

-- metrics: queried by project_id on dashboard metrics panel
CREATE INDEX IF NOT EXISTS idx_metrics_project
  ON metrics(project_id);

-- metric_entries: sorted by date for time-series display
CREATE INDEX IF NOT EXISTS idx_metric_entries_metric_date
  ON metric_entries(metric_id, date DESC);

-- growth_loops: queried by project_id on growth page
CREATE INDEX IF NOT EXISTS idx_growth_loops_project
  ON growth_loops(project_id);

-- alerts: queried by project_id + dismissed on dashboard
CREATE INDEX IF NOT EXISTS idx_alerts_project
  ON alerts(project_id);

-- milestones: queried by project_id on journey page
CREATE INDEX IF NOT EXISTS idx_milestones_project
  ON milestones(project_id);

-- skill_completions: queried by project_id on skills + cron heartbeat
CREATE INDEX IF NOT EXISTS idx_skill_completions_project
  ON skill_completions(project_id);

-- investor_interactions: cascading deletes + list queries by investor
CREATE INDEX IF NOT EXISTS idx_investor_interactions_investor
  ON investor_interactions(investor_id);

-- chat_messages: common query is project_id + ORDER BY timestamp DESC
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_timestamp
  ON chat_messages(project_id, "timestamp" DESC);

-- graph_nodes: queried by project_id on knowledge graph page
CREATE INDEX IF NOT EXISTS idx_graph_nodes_project
  ON graph_nodes(project_id);

-- graph_edges: queried by project_id on knowledge graph page
CREATE INDEX IF NOT EXISTS idx_graph_edges_project
  ON graph_edges(project_id);

-- monitor_runs: queried by run_at for cron audit log
CREATE INDEX IF NOT EXISTS idx_monitor_runs_run_at
  ON monitor_runs(run_at DESC);

-- startup_updates: queried by project_id + date on journey page
CREATE INDEX IF NOT EXISTS idx_startup_updates_project
  ON startup_updates(project_id, date DESC);
