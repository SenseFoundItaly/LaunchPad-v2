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
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  tools_json TEXT
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
  cap_llm_usd DOUBLE PRECISION DEFAULT 5.00,
  cap_external_actions INTEGER DEFAULT 20,
  warn_llm_usd DOUBLE PRECISION DEFAULT 4.00,
  warn_external_actions INTEGER DEFAULT 16,
  current_llm_usd DOUBLE PRECISION DEFAULT 0,
  current_external_actions INTEGER DEFAULT 0,
  cap_credits INTEGER DEFAULT 500,
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

-- =============================================================================
-- Watch Sources (URL-based change detection for market signals)
-- =============================================================================
CREATE TABLE IF NOT EXISTS watch_sources (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  label VARCHAR NOT NULL,
  category VARCHAR NOT NULL DEFAULT 'custom',
  scrape_config JSONB DEFAULT '{}',
  schedule VARCHAR NOT NULL DEFAULT 'daily',
  last_snapshot TEXT,
  last_content_hash VARCHAR,
  last_scraped_at TIMESTAMP,
  next_scrape_at TIMESTAMP,
  status VARCHAR NOT NULL DEFAULT 'active',
  error_message TEXT,
  error_count INTEGER DEFAULT 0,
  change_tracking_tag VARCHAR,
  monitor_id VARCHAR REFERENCES monitors(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_watch_sources_project_status
  ON watch_sources(project_id, status);
CREATE INDEX IF NOT EXISTS idx_watch_sources_next_scrape
  ON watch_sources(next_scrape_at)
  WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_sources_project_url
  ON watch_sources(project_id, url);

-- =============================================================================
-- Source Changes (detected content diffs from watch sources)
-- =============================================================================
CREATE TABLE IF NOT EXISTS source_changes (
  id VARCHAR PRIMARY KEY,
  watch_source_id VARCHAR NOT NULL REFERENCES watch_sources(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  change_status VARCHAR NOT NULL,
  diff_summary TEXT,
  raw_diff TEXT,
  previous_content_hash VARCHAR,
  current_content_hash VARCHAR,
  significance VARCHAR NOT NULL DEFAULT 'noise',
  significance_rationale TEXT,
  alert_id VARCHAR REFERENCES ecosystem_alerts(id) ON DELETE SET NULL,
  detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_source_changes_project_detected
  ON source_changes(project_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_changes_source_detected
  ON source_changes(watch_source_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_changes_project_significance
  ON source_changes(project_id, significance);

-- =============================================================================
-- Intelligence Briefs (cross-signal correlation synthesis)
-- =============================================================================
CREATE TABLE IF NOT EXISTS intelligence_briefs (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  brief_type VARCHAR NOT NULL DEFAULT 'correlation',
  entity_name VARCHAR,
  title TEXT NOT NULL,
  narrative TEXT NOT NULL,
  temporal_prediction TEXT,
  confidence DOUBLE PRECISION DEFAULT 0.7,
  signal_ids JSONB NOT NULL DEFAULT '[]',
  signal_count INTEGER DEFAULT 0,
  recommended_actions JSONB DEFAULT '[]',
  valid_until TIMESTAMP,
  status VARCHAR NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ib_project_created
  ON intelligence_briefs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ib_project_status
  ON intelligence_briefs(project_id, status)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ib_entity
  ON intelligence_briefs(project_id, entity_name)
  WHERE entity_name IS NOT NULL;

-- =============================================================================
-- Competitor Profiles (per-competitor intelligence dossiers)
-- =============================================================================
CREATE TABLE IF NOT EXISTS competitor_profiles (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR NOT NULL,
  slug VARCHAR NOT NULL,
  description TEXT,
  signal_counts JSONB DEFAULT '{}',
  total_signals INTEGER DEFAULT 0,
  latest_brief_id VARCHAR REFERENCES intelligence_briefs(id) ON DELETE SET NULL,
  trend_direction VARCHAR DEFAULT 'stable',
  last_activity_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_cp_project
  ON competitor_profiles(project_id);

-- =============================================================================
-- Build Artifacts (generated deliverables: landing pages, pitch decks, one-pagers)
-- =============================================================================
CREATE TABLE IF NOT EXISTS build_artifacts (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  skill_id VARCHAR NOT NULL,
  artifact_type VARCHAR NOT NULL,
  title VARCHAR NOT NULL,
  content TEXT NOT NULL,
  doc_type VARCHAR,
  metadata JSONB DEFAULT '{}',
  sources JSONB DEFAULT '[]',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ba_project
  ON build_artifacts(project_id);

-- =============================================================================
-- Signal Activity Logs (audit trail for signal pipeline events)
-- =============================================================================
CREATE TABLE IF NOT EXISTS signal_activity_logs (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type VARCHAR NOT NULL,
  entity_id VARCHAR,
  entity_type VARCHAR,
  headline TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signal_logs_project_time
  ON signal_activity_logs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_logs_project_type
  ON signal_activity_logs(project_id, event_type);

-- =============================================================================
-- Cron Runs (audit log for the cron system itself)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  duration_ms INTEGER,
  monitors_ran INTEGER DEFAULT 0,
  watch_sources_processed INTEGER DEFAULT 0,
  correlations_ran INTEGER DEFAULT 0,
  heartbeats_ran INTEGER DEFAULT 0,
  notifications_dismissed INTEGER DEFAULT 0,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_started_at ON cron_runs(started_at DESC);

-- =============================================================================
-- Migration: Raise budget caps for active projects (May 2026)
-- Old defaults ($0.50 cap / $0.40 warn / 100 credits) allowed only ~13 chat
-- messages/month. New defaults ($5.00 / $4.00 / 500) support ~131 messages.
-- Idempotent: only touches rows still on the old defaults.
-- =============================================================================
UPDATE project_budgets
SET cap_llm_usd = 5.00,
    warn_llm_usd = 4.00,
    cap_credits = 500
WHERE cap_llm_usd <= 0.60
  AND warn_llm_usd <= 0.48
  AND status = 'active';

ALTER TABLE project_budgets ALTER COLUMN cap_llm_usd SET DEFAULT 5.00;
ALTER TABLE project_budgets ALTER COLUMN warn_llm_usd SET DEFAULT 4.00;
ALTER TABLE project_budgets ALTER COLUMN cap_credits SET DEFAULT 500;
