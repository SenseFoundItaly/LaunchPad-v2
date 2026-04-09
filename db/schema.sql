-- LaunchPad v2 — SQLite Schema
-- All tables for the Startup OS data layer

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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Idea Canvas
-- =============================================================================
CREATE TABLE IF NOT EXISTS idea_canvas (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  problem TEXT,
  solution TEXT,
  target_market TEXT,
  business_model TEXT,
  competitive_advantage TEXT,
  value_proposition TEXT,
  unfair_advantage TEXT,
  key_metrics JSON,
  revenue_streams JSON,
  cost_structure JSON,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Scores
-- =============================================================================
CREATE TABLE IF NOT EXISTS scores (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  overall_score FLOAT,
  dimensions JSON,
  benchmark TEXT,
  recommendation TEXT,
  scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Research
-- =============================================================================
CREATE TABLE IF NOT EXISTS research (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  market_size JSON,
  competitors JSON,
  trends JSON,
  case_studies JSON,
  key_insights JSON,
  researched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Simulation
-- =============================================================================
CREATE TABLE IF NOT EXISTS simulation (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  personas JSON,
  risk_scenarios JSON,
  market_reception_summary TEXT,
  investor_sentiment TEXT,
  simulated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Workflow
-- =============================================================================
CREATE TABLE IF NOT EXISTS workflow (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  gtm_strategy JSON,
  pitch_deck JSON,
  financial_model JSON,
  roadmap JSON,
  action_items JSON,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Metrics (Command Center)
-- =============================================================================
CREATE TABLE IF NOT EXISTS metrics (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  name VARCHAR NOT NULL,
  type VARCHAR DEFAULT 'count',
  target_growth_rate FLOAT DEFAULT 0.07,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS metric_entries (
  id VARCHAR PRIMARY KEY,
  metric_id VARCHAR REFERENCES metrics(id),
  date DATE NOT NULL,
  value FLOAT NOT NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Burn Rate
-- =============================================================================
CREATE TABLE IF NOT EXISTS burn_rate (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  monthly_burn FLOAT,
  cash_on_hand FLOAT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Alerts
-- =============================================================================
CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
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
  project_id VARCHAR REFERENCES projects(id),
  metric_name VARCHAR,
  optimization_target VARCHAR,
  status VARCHAR DEFAULT 'active',
  baseline_value FLOAT,
  current_best_value FLOAT,
  accumulated_learnings TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS growth_iterations (
  id VARCHAR PRIMARY KEY,
  loop_id VARCHAR REFERENCES growth_loops(id),
  hypothesis TEXT,
  proposed_changes JSON,
  status VARCHAR DEFAULT 'proposed',
  result_value FLOAT,
  improvement_pct FLOAT,
  learnings TEXT,
  adopted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Investors
-- =============================================================================
CREATE TABLE IF NOT EXISTS investors (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  name VARCHAR NOT NULL,
  type VARCHAR,
  contact_name VARCHAR,
  contact_email VARCHAR,
  stage VARCHAR DEFAULT 'target',
  check_size FLOAT,
  notes TEXT,
  tags JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS investor_interactions (
  id VARCHAR PRIMARY KEY,
  investor_id VARCHAR REFERENCES investors(id),
  type VARCHAR,
  summary TEXT,
  next_step TEXT,
  next_step_date DATE,
  date DATE DEFAULT (date('now'))
);

CREATE TABLE IF NOT EXISTS fundraising_rounds (
  project_id VARCHAR PRIMARY KEY REFERENCES projects(id),
  round_type VARCHAR,
  target_amount FLOAT,
  valuation_cap FLOAT,
  instrument VARCHAR DEFAULT 'SAFE',
  status VARCHAR DEFAULT 'planning',
  target_close DATE
);

-- =============================================================================
-- Pitch Versions
-- =============================================================================
CREATE TABLE IF NOT EXISTS pitch_versions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  version_number INTEGER,
  slides JSON,
  feedback_summary TEXT,
  changelog JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Term Sheets
-- =============================================================================
CREATE TABLE IF NOT EXISTS term_sheets (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  investor_id VARCHAR REFERENCES investors(id),
  valuation FLOAT,
  amount FLOAT,
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
  project_id VARCHAR REFERENCES projects(id),
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
  project_id VARCHAR REFERENCES projects(id),
  period VARCHAR,
  metrics_snapshot JSON,
  highlights JSON,
  challenges JSON,
  asks JSON,
  morale INTEGER,
  generated_summary TEXT,
  date DATE DEFAULT (date('now'))
);

-- =============================================================================
-- Monitors (scheduled background checks per project)
-- =============================================================================
CREATE TABLE IF NOT EXISTS monitors (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  type VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  schedule VARCHAR DEFAULT 'weekly',
  config JSON,
  prompt TEXT,
  status VARCHAR DEFAULT 'active',
  last_run TIMESTAMP,
  last_result TEXT,
  next_run TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Monitor Runs (history of monitor executions)
-- =============================================================================
CREATE TABLE IF NOT EXISTS monitor_runs (
  id VARCHAR PRIMARY KEY,
  monitor_id VARCHAR REFERENCES monitors(id),
  project_id VARCHAR REFERENCES projects(id),
  status VARCHAR DEFAULT 'completed',
  summary TEXT,
  alerts_generated INTEGER DEFAULT 0,
  run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Skill Completions (tracks which skills have been run per project)
-- =============================================================================
CREATE TABLE IF NOT EXISTS skill_completions (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
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
  project_id VARCHAR REFERENCES projects(id),
  step VARCHAR,
  role VARCHAR,
  content TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- Knowledge Graph
-- =============================================================================
CREATE TABLE IF NOT EXISTS graph_nodes (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  name VARCHAR NOT NULL,
  node_type VARCHAR NOT NULL,
  summary TEXT,
  attributes JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR REFERENCES projects(id),
  source_node_id VARCHAR REFERENCES graph_nodes(id),
  target_node_id VARCHAR REFERENCES graph_nodes(id),
  relation VARCHAR NOT NULL,
  label TEXT,
  weight FLOAT DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
