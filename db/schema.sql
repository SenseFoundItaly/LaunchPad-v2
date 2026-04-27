-- LaunchPad v2 — PostgreSQL Schema (Supabase)
-- All tables for the Startup OS data layer

-- =============================================================================
-- Auth: shadow users + organizations + memberships
-- Supabase Auth owns the primary user record. We mirror the UUID here so our
-- data has a stable FK target.
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);

-- =============================================================================
-- Projects
-- =============================================================================
CREATE TABLE IF NOT EXISTS projects (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  status VARCHAR DEFAULT 'created',
  current_step INTEGER DEFAULT 1,
  llm_provider VARCHAR DEFAULT 'openai',
  partner_slug VARCHAR,
  locale VARCHAR DEFAULT 'en',
  owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  org_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id);

-- =============================================================================
-- Idea Canvas
-- =============================================================================
CREATE TABLE IF NOT EXISTS idea_canvas (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  problem TEXT,
  solution TEXT,
  target_market TEXT,
  business_model TEXT,
  competitive_advantage TEXT,
  value_proposition TEXT,
  unfair_advantage TEXT,
  key_metrics JSONB,
  revenue_streams JSONB,
  cost_structure JSONB,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Scores
-- =============================================================================
CREATE TABLE IF NOT EXISTS scores (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  overall_score DOUBLE PRECISION,
  dimensions JSONB,
  benchmark TEXT,
  recommendation TEXT,
  sources JSONB,
  scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Research
-- =============================================================================
CREATE TABLE IF NOT EXISTS research (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  market_size JSONB,
  competitors JSONB,
  trends JSONB,
  case_studies JSONB,
  key_insights JSONB,
  sources JSONB,
  researched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Simulation
-- =============================================================================
CREATE TABLE IF NOT EXISTS simulation (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  personas JSONB,
  risk_scenarios JSONB,
  market_reception_summary TEXT,
  investor_sentiment TEXT,
  scenario_sources JSONB,
  simulated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Workflow
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  gtm_strategy JSONB,
  pitch_deck JSONB,
  financial_model JSONB,
  roadmap JSONB,
  action_items JSONB,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Metrics (Command Center)
-- =============================================================================
CREATE TABLE IF NOT EXISTS metrics (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  type VARCHAR DEFAULT 'count',
  target_growth_rate DOUBLE PRECISION DEFAULT 0.07,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metric_entries (
  id VARCHAR PRIMARY KEY,
  metric_id VARCHAR REFERENCES metrics(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Burn Rate
-- =============================================================================
CREATE TABLE IF NOT EXISTS burn_rate (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  monthly_burn DOUBLE PRECISION,
  cash_on_hand DOUBLE PRECISION,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Alerts
-- =============================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR,
  severity VARCHAR DEFAULT 'info',
  message TEXT,
  dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Growth Loops
-- =============================================================================
CREATE TABLE IF NOT EXISTS growth_loops (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  metric_name VARCHAR,
  optimization_target VARCHAR,
  status VARCHAR DEFAULT 'active',
  baseline_value DOUBLE PRECISION,
  current_best_value DOUBLE PRECISION,
  accumulated_learnings TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS growth_iterations (
  id VARCHAR PRIMARY KEY,
  loop_id VARCHAR REFERENCES growth_loops(id) ON DELETE CASCADE,
  hypothesis TEXT,
  proposed_changes JSONB,
  status VARCHAR DEFAULT 'proposed',
  result_value DOUBLE PRECISION,
  improvement_pct DOUBLE PRECISION,
  learnings TEXT,
  adopted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Investors
-- =============================================================================
CREATE TABLE IF NOT EXISTS investors (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  type VARCHAR,
  contact_name VARCHAR,
  contact_email VARCHAR,
  stage VARCHAR DEFAULT 'target',
  check_size DOUBLE PRECISION,
  notes TEXT,
  tags JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investor_interactions (
  id VARCHAR PRIMARY KEY,
  investor_id VARCHAR REFERENCES investors(id) ON DELETE CASCADE,
  type VARCHAR,
  summary TEXT,
  next_step TEXT,
  next_step_date DATE,
  date DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS fundraising_rounds (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  round_type VARCHAR,
  target_amount DOUBLE PRECISION,
  valuation_cap DOUBLE PRECISION,
  instrument VARCHAR DEFAULT 'SAFE',
  status VARCHAR DEFAULT 'planning',
  target_close DATE
);

-- =============================================================================
-- Pitch Versions
-- =============================================================================
CREATE TABLE IF NOT EXISTS pitch_versions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  version_number INTEGER,
  slides JSONB,
  feedback_summary TEXT,
  changelog JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Term Sheets
-- =============================================================================
CREATE TABLE IF NOT EXISTS term_sheets (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  investor_id VARCHAR REFERENCES investors(id) ON DELETE SET NULL,
  valuation DOUBLE PRECISION,
  amount DOUBLE PRECISION,
  instrument VARCHAR,
  key_terms TEXT,
  status VARCHAR DEFAULT 'received',
  notes TEXT,
  received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Journey
-- =============================================================================
CREATE TABLE IF NOT EXISTS milestones (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  week INTEGER,
  phase VARCHAR,
  title VARCHAR NOT NULL,
  description TEXT,
  status VARCHAR DEFAULT 'upcoming',
  linked_feature VARCHAR,
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS startup_updates (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  period VARCHAR,
  metrics_snapshot JSONB,
  highlights JSONB,
  challenges JSONB,
  asks JSONB,
  morale INTEGER,
  generated_summary TEXT,
  date DATE DEFAULT CURRENT_DATE
);

-- =============================================================================
-- Skill Completions (tracks which skills have been run per project)
-- =============================================================================
CREATE TABLE IF NOT EXISTS skill_completions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  skill_id VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'completed',
  summary TEXT,
  completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, skill_id)
);

-- =============================================================================
-- Chat History
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_messages (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  step VARCHAR,
  role VARCHAR,
  content TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);

-- =============================================================================
-- Tools (registry of available tool definitions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tools (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL UNIQUE,
  display_name VARCHAR NOT NULL,
  description TEXT,
  category VARCHAR NOT NULL,
  input_schema JSONB,
  handler_type VARCHAR NOT NULL,
  handler_config JSONB,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Drafts (versioned artifacts)
-- =============================================================================
CREATE TABLE IF NOT EXISTS drafts (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  draft_type VARCHAR NOT NULL,
  status VARCHAR DEFAULT 'draft',
  current_version INTEGER DEFAULT 1,
  published_url VARCHAR,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS draft_versions (
  id VARCHAR PRIMARY KEY,
  draft_id VARCHAR REFERENCES drafts(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  content JSONB NOT NULL,
  content_type VARCHAR NOT NULL,
  rendered_html TEXT,
  changelog TEXT,
  created_by VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(draft_id, version_number)
);

-- =============================================================================
-- Tool Executions (persistent task queue)
-- =============================================================================
CREATE TABLE IF NOT EXISTS tool_executions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  tool_id VARCHAR,
  draft_id VARCHAR,
  workflow_run_id VARCHAR,
  step_index INTEGER,
  status VARCHAR DEFAULT 'pending',
  input_params JSONB,
  output JSONB,
  error TEXT,
  sandbox_id VARCHAR,
  logs TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Workflow Plans (executable multi-step chains)
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow_plans (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  description TEXT,
  steps JSONB NOT NULL,
  status VARCHAR DEFAULT 'planned',
  current_step INTEGER DEFAULT 0,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Published Assets
-- =============================================================================
CREATE TABLE IF NOT EXISTS published_assets (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  draft_id VARCHAR,
  draft_version_id VARCHAR,
  asset_type VARCHAR NOT NULL,
  slug VARCHAR NOT NULL UNIQUE,
  daytona_workspace_id VARCHAR,
  daytona_url VARCHAR,
  metadata JSONB,
  is_active BOOLEAN DEFAULT true,
  published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- LLM Usage Logs (telemetry / cost tracking)
-- =============================================================================
CREATE TABLE IF NOT EXISTS llm_usage_logs (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  skill_id VARCHAR,
  step VARCHAR,
  provider VARCHAR,
  model VARCHAR,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cache_creation_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  total_cost_usd DOUBLE PRECISION DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_logs_user ON llm_usage_logs(user_id);

-- =============================================================================
-- Monitors (scheduled background checks per project)
-- =============================================================================
CREATE TABLE IF NOT EXISTS monitors (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  type VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  schedule VARCHAR DEFAULT 'weekly',
  config JSONB,
  prompt TEXT,
  status VARCHAR DEFAULT 'active',
  last_run TIMESTAMP,
  last_result TEXT,
  next_run TIMESTAMP,
  linked_risk_id TEXT,
  linked_quote TEXT,
  kind TEXT,
  urls_to_track JSONB,
  dedup_hash TEXT,
  dedup_override_reason TEXT,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_monitors_project_risk_kind
  ON monitors(project_id, linked_risk_id, kind, status);
CREATE INDEX IF NOT EXISTS idx_monitors_project_dedup
  ON monitors(project_id, dedup_hash);

CREATE TABLE IF NOT EXISTS monitor_runs (
  id VARCHAR PRIMARY KEY,
  monitor_id VARCHAR REFERENCES monitors(id) ON DELETE CASCADE,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  status VARCHAR DEFAULT 'completed',
  summary TEXT,
  alerts_generated INTEGER DEFAULT 0,
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Knowledge Graph
-- =============================================================================
CREATE TABLE IF NOT EXISTS graph_nodes (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  node_type VARCHAR NOT NULL,
  summary TEXT,
  attributes JSONB,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  source_node_id VARCHAR REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id VARCHAR REFERENCES graph_nodes(id) ON DELETE CASCADE,
  relation VARCHAR NOT NULL,
  label TEXT,
  weight DOUBLE PRECISION DEFAULT 1.0,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Ecosystem Alerts (Layer 1 autonomous intelligence feed)
-- =============================================================================
CREATE TABLE IF NOT EXISTS ecosystem_alerts (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  monitor_id VARCHAR REFERENCES monitors(id) ON DELETE SET NULL,
  monitor_run_id VARCHAR REFERENCES monitor_runs(id) ON DELETE SET NULL,
  alert_type VARCHAR NOT NULL,
  source VARCHAR,
  source_url VARCHAR,
  headline TEXT NOT NULL,
  body TEXT,
  relevance_score DOUBLE PRECISION DEFAULT 0.5,
  confidence DOUBLE PRECISION DEFAULT 0.5,
  graph_node_id VARCHAR REFERENCES graph_nodes(id) ON DELETE SET NULL,
  reviewed_state VARCHAR DEFAULT 'pending',
  reviewed_at TIMESTAMP,
  founder_action_taken VARCHAR,
  dedupe_hash VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, dedupe_hash)
);

CREATE INDEX IF NOT EXISTS idx_ecosystem_alerts_project_created
  ON ecosystem_alerts(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ecosystem_alerts_project_relevance
  ON ecosystem_alerts(project_id, relevance_score DESC)
  WHERE reviewed_state = 'pending';

-- =============================================================================
-- Pending Actions (approval inbox)
-- =============================================================================
CREATE TABLE IF NOT EXISTS pending_actions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  monitor_run_id VARCHAR REFERENCES monitor_runs(id) ON DELETE SET NULL,
  ecosystem_alert_id VARCHAR REFERENCES ecosystem_alerts(id) ON DELETE SET NULL,
  action_type VARCHAR NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT,
  payload JSONB NOT NULL,
  estimated_impact VARCHAR,
  status VARCHAR DEFAULT 'pending',
  edited_payload JSONB,
  execution_target VARCHAR,
  executed_at TIMESTAMP,
  execution_result JSONB,
  priority TEXT,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pending_actions_project_status
  ON pending_actions(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_actions_project_type_status
  ON pending_actions(project_id, action_type, status);

-- =============================================================================
-- Partner Configs
-- =============================================================================
CREATE TABLE IF NOT EXISTS partner_configs (
  slug VARCHAR PRIMARY KEY,
  display_name VARCHAR NOT NULL,
  locale VARCHAR DEFAULT 'en',
  knowledge_seed JSONB,
  preferred_skills JSONB,
  brief_template VARCHAR DEFAULT 'default',
  brand JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Project Budgets (cost governance)
-- =============================================================================
CREATE TABLE IF NOT EXISTS project_budgets (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id) ON DELETE CASCADE,
  period_month VARCHAR NOT NULL,
  cap_llm_usd DOUBLE PRECISION DEFAULT 0.30,
  cap_external_actions INTEGER DEFAULT 20,
  warn_llm_usd DOUBLE PRECISION DEFAULT 0.24,
  warn_external_actions INTEGER DEFAULT 16,
  current_llm_usd DOUBLE PRECISION DEFAULT 0,
  current_external_actions INTEGER DEFAULT 0,
  status VARCHAR DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_project_budgets_project_period
  ON project_budgets(project_id, period_month);

-- =============================================================================
-- Memory layer
-- =============================================================================
CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  fact TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fact',
  source_type TEXT,
  source_id TEXT,
  confidence DOUBLE PRECISION DEFAULT 1.0,
  dismissed BOOLEAN DEFAULT false,
  embedding BYTEA,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_user_project
  ON memory_facts(user_id, project_id, dismissed, updated_at);

CREATE TABLE IF NOT EXISTS memory_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memory_events_user_project
  ON memory_events(user_id, project_id, created_at);
