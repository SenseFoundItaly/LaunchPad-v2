-- Migration 008: Structured customer/user interviews.
--
-- Before this table, "interviews" lived as freeform text in memory_facts and
-- Stage 2's interviews_logged check did fuzzy keyword matching on content.
-- That worked but missed the founder's actual data goals — they want to know
-- who they talked to, when, what hurt, and how much they'd pay. Now that's
-- a first-class table; Stage 2 counts rows here directly.
--
-- Shape rationale:
--   - structured columns for the fields stage checks need (count, pain text,
--     wtp_amount) so SQL stays simple
--   - meta JSONB for everything else (sentiment, transcript, followup state)
--     so the schema doesn't migrate every time we sharpen the interview rubric
--   - sources JSONB matches the Source[] shape used by memory_facts +
--     pending_actions, so the agent can cite the same way

CREATE TABLE IF NOT EXISTS interviews (
  id              TEXT PRIMARY KEY,
  project_id      VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- WHO
  person_name     TEXT NOT NULL,
  person_role     TEXT,
  person_segment  TEXT,             -- which ICP / target segment they map to

  -- WHEN / HOW
  conducted_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  channel         TEXT,             -- call | email | survey | in-person | linkedin | other

  -- WHAT (the meat — drives Stage 2 evidence)
  summary         TEXT NOT NULL,    -- 1-3 sentence takeaway, agent-readable
  top_pain        TEXT,             -- verbatim biggest pain quote
  urgency         TEXT,             -- low | medium | high (how badly they need a fix)

  -- WHAT (pricing signal — drives Stage 6 evidence)
  wtp_amount      DOUBLE PRECISION, -- what they'd pay, nullable
  wtp_currency    VARCHAR(3) DEFAULT 'USD',

  -- Overflow for future fields (transcript, sentiment, competitor_mentioned,
  -- followup_planned, recording_url). JSONB so we don't churn the schema.
  meta            JSONB DEFAULT '{}'::jsonb,

  -- Provenance: calendar event ref, chat-turn ref, doc URL, etc.
  sources         JSONB DEFAULT '[]'::jsonb,

  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_interviews_project_conducted
  ON interviews(project_id, conducted_at DESC);
