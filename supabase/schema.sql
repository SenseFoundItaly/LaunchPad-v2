-- LaunchPad v2 — Supabase Postgres Schema with RLS
-- Run this in Supabase SQL Editor

-- =============================================================================
-- Projects (user-scoped)
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  name VARCHAR NOT NULL,
  description TEXT,
  status VARCHAR DEFAULT 'created',
  current_step INTEGER DEFAULT 1,
  llm_provider VARCHAR DEFAULT 'anthropic',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own projects" ON projects FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Skill Completions
-- =============================================================================
CREATE TABLE IF NOT EXISTS skill_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  skill_id VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'completed',
  summary TEXT,
  completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, skill_id)
);

ALTER TABLE skill_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own skill completions" ON skill_completions FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Chat Messages
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  step VARCHAR,
  role VARCHAR,
  content TEXT,
  timestamp TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own chat messages" ON chat_messages FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Knowledge Graph
-- =============================================================================
CREATE TABLE IF NOT EXISTS graph_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  name VARCHAR NOT NULL,
  node_type VARCHAR NOT NULL,
  summary TEXT,
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own graph nodes" ON graph_nodes FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS graph_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  source_node_id UUID REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id UUID REFERENCES graph_nodes(id) ON DELETE CASCADE,
  relation VARCHAR NOT NULL,
  label TEXT,
  weight FLOAT DEFAULT 1.0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own graph edges" ON graph_edges FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Monitors (scheduled background checks)
-- =============================================================================
CREATE TABLE IF NOT EXISTS monitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  type VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  schedule VARCHAR DEFAULT 'weekly',
  config JSONB DEFAULT '{}',
  prompt TEXT,
  status VARCHAR DEFAULT 'active',
  last_run TIMESTAMPTZ,
  last_result TEXT,
  next_run TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE monitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own monitors" ON monitors FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id UUID REFERENCES monitors(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  status VARCHAR DEFAULT 'completed',
  summary TEXT,
  alerts_generated INTEGER DEFAULT 0,
  run_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE monitor_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own monitor runs" ON monitor_runs FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Alerts
-- =============================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  monitor_id UUID REFERENCES monitors(id) ON DELETE SET NULL,
  type VARCHAR,
  severity VARCHAR DEFAULT 'info',
  message TEXT,
  dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own alerts" ON alerts FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Metrics
-- =============================================================================
CREATE TABLE IF NOT EXISTS metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  name VARCHAR NOT NULL,
  type VARCHAR DEFAULT 'count',
  target_growth_rate FLOAT DEFAULT 0.07,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own metrics" ON metrics FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS metric_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_id UUID REFERENCES metrics(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  date DATE NOT NULL,
  value FLOAT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE metric_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own metric entries" ON metric_entries FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Burn Rate
-- =============================================================================
CREATE TABLE IF NOT EXISTS burn_rate (
  project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  monthly_burn FLOAT,
  cash_on_hand FLOAT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE burn_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own burn rate" ON burn_rate FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Investors
-- =============================================================================
CREATE TABLE IF NOT EXISTS investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) NOT NULL DEFAULT auth.uid(),
  name VARCHAR NOT NULL,
  type VARCHAR,
  contact_name VARCHAR,
  contact_email VARCHAR,
  stage VARCHAR DEFAULT 'target',
  check_size FLOAT,
  notes TEXT,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE investors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own investors" ON investors FOR ALL USING (auth.uid() = user_id);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_skill_completions_project ON skill_completions(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_project_step ON chat_messages(project_id, step);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_project ON graph_nodes(project_id);
CREATE INDEX IF NOT EXISTS idx_monitors_project ON monitors(project_id);
CREATE INDEX IF NOT EXISTS idx_alerts_project ON alerts(project_id, dismissed);
CREATE INDEX IF NOT EXISTS idx_metrics_project ON metrics(project_id);
