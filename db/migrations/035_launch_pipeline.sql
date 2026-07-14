-- 035: Launch pipeline (growth lane) — campaigns + campaign_messages tables,
-- real-hosting columns on published_assets, and two new founder-gated action
-- types (publish_landing_page, send_campaign_message).
--
-- published_assets gains hosting columns instead of reusing the dormant
-- daytona_* pair: those belong to a retired integration and renaming them
-- risks drift against rows the legacy tools wrote. Campaign send-state gets
-- its own tables — per-message lifecycle (draft→proposed→sent) doesn't fit
-- published_assets (slug UNIQUE, no lifecycle) or workflow_plans (steps blob).
--
-- CHECK list below = the live constraint as of 2026-07-14 (24 values, incl.
-- mvp_build_iteration from migration 033) + the 2 new types. Verified via
-- pg_get_constraintdef before writing.

ALTER TABLE published_assets ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE published_assets ADD COLUMN IF NOT EXISTS host_ref VARCHAR;
ALTER TABLE published_assets ADD COLUMN IF NOT EXISTS publisher VARCHAR;
ALTER TABLE published_assets ADD COLUMN IF NOT EXISTS source_artifact_id VARCHAR;
ALTER TABLE published_assets ADD COLUMN IF NOT EXISTS source_build_id VARCHAR;
ALTER TABLE published_assets ADD COLUMN IF NOT EXISTS watch_source_id VARCHAR;

CREATE TABLE IF NOT EXISTS campaigns (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind VARCHAR NOT NULL,                    -- email_sequence | social_calendar | ad_pack
  title VARCHAR NOT NULL,
  source_artifact_id VARCHAR,               -- build_artifacts(id) that generated it
  status VARCHAR NOT NULL DEFAULT 'draft',  -- draft | active | paused | completed | archived
  config JSONB DEFAULT '{}',                -- recipients[], cadence (founder-provided)
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id, status);

CREATE TABLE IF NOT EXISTS campaign_messages (
  id VARCHAR PRIMARY KEY,
  campaign_id VARCHAR NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  channel VARCHAR NOT NULL,                 -- email | linkedin | x | other
  position INTEGER NOT NULL DEFAULT 1,
  subject VARCHAR,
  body TEXT NOT NULL,
  scheduled_at TIMESTAMP,                   -- when cron should PROPOSE the send
  status VARCHAR NOT NULL DEFAULT 'draft',  -- draft | proposed | sent | skipped | failed
  sent_at TIMESTAMP,
  send_ref VARCHAR,                         -- resend broadcast id / share URL / 'stub'
  recipient_count INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_campaign_messages_due
  ON campaign_messages(project_id, status, scheduled_at);

ALTER TABLE pending_actions DROP CONSTRAINT IF EXISTS pending_actions_action_type_check;
ALTER TABLE pending_actions ADD CONSTRAINT pending_actions_action_type_check CHECK (
  action_type IN (
    'draft_email','draft_linkedin_post','draft_linkedin_dm','proposed_hypothesis',
    'proposed_interview_question','proposed_landing_copy','proposed_investor_followup',
    'proposed_graph_update','workflow_step','configure_monitor','edit_monitor','delete_monitor',
    'configure_budget','configure_watch_source','run_skill','skill_rerun_result',
    'validation_proposal','task','signal_alert','intelligence_brief','assumption_review',
    'raw_change','propose_assumption_revision','mvp_build_iteration',
    'publish_landing_page',
    'send_campaign_message'
  )
);
