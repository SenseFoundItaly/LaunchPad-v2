-- 044 — funding_calls: grant calls as DATA with a parsed deadline, not LLM prose.
--
-- Why: PR #450's first live grants run shipped a past-dated call. The LLM path
-- cannot be trusted with dates. This table is fed by src/lib/grants/sync.ts from
-- typed source fields (SEDIA search-api deadlineDate, Lombardia Socrata
-- chiusura_adesione / detail page "Scade il"), never from a model.
--
-- funding_calls is GLOBAL (no project_id): a call exists whether or not any
-- project watches it. Per-project visibility is an ecosystem_alerts row
-- (alert_type='funding_event') keyed by the new funding_call_id column —
-- one alert per (project, call), so a deadline extension updates the call
-- in place instead of spawning a duplicate alert.
--
-- status: open    = source lists it with a future (or NULL-time today) deadline
--         rolling = source lists it open with NO closing date (sportello /
--                   until funds exhausted) — surfaced, not hidden
--         closed  = deadline passed (daily expiry) OR the identifier vanished
--                   from its source for 2 consecutive successful syncs
--                   (missed_syncs >= 2). closed_at is set on either path.
-- raw_snippet: the exact source substring the deadline was parsed from.
-- parse_method: iso_field (SEDIA deadlineDate) | socrata_field
--               (chiusura_adesione) | regex (Lombardia detail page "Scade il").
-- deadline_time: 'HH:MM' local (Europe/Rome for lombardia); NULL when the
--               source only carries a date.
--
-- funding_source_state carries the zero-results alarm: last_success_at is
-- ONLY advanced by a sync that returned >0 rows, and the cron's once-per-day
-- gate reads it, so a source that returns nothing is retried next tick and
-- never closes its calls (sync skips mark-closed when fetched == 0).
--
-- Numbering: 044 — CONFIRMED against `SELECT name FROM _migrations` on the live
-- DB (ledger top: 043_north_star_sections.sql) at authoring time. Re-confirm
-- before applying; the number comes from the ledger, never from this directory.
-- Additive + idempotent.

CREATE TABLE IF NOT EXISTS funding_calls (
  id                VARCHAR PRIMARY KEY,
  source            VARCHAR NOT NULL CHECK (source IN ('sedia', 'lombardia')),
  source_identifier VARCHAR NOT NULL,
  official_url      VARCHAR NOT NULL,
  title             TEXT NOT NULL,
  granting_body     TEXT,
  deadline          DATE,
  deadline_time     VARCHAR,
  status            VARCHAR NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'rolling', 'closed')),
  eligibility_text  TEXT,
  raw_snippet       TEXT,
  parse_method      VARCHAR
                    CHECK (parse_method IS NULL OR parse_method IN ('iso_field', 'socrata_field', 'regex')),
  missed_syncs      INTEGER NOT NULL DEFAULT 0,
  first_seen_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_verified_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at         TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source, source_identifier)
);

CREATE INDEX IF NOT EXISTS idx_funding_calls_status_deadline
  ON funding_calls (status, deadline);

CREATE TABLE IF NOT EXISTS funding_source_state (
  source          VARCHAR PRIMARY KEY CHECK (source IN ('sedia', 'lombardia')),
  last_success_at TIMESTAMP,
  last_error      TEXT,
  last_count      INTEGER,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO funding_source_state (source) VALUES ('sedia'), ('lombardia')
ON CONFLICT (source) DO NOTHING;

ALTER TABLE ecosystem_alerts
  ADD COLUMN IF NOT EXISTS funding_call_id VARCHAR REFERENCES funding_calls(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ecosystem_alerts_funding_call
  ON ecosystem_alerts (funding_call_id)
  WHERE funding_call_id IS NOT NULL;

-- one alert per (project, call): the sync inserts with ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ecosystem_alerts_project_funding_call
  ON ecosystem_alerts (project_id, funding_call_id)
  WHERE funding_call_id IS NOT NULL;

COMMENT ON COLUMN ecosystem_alerts.funding_call_id IS
  'Set by src/lib/grants/sync.ts for parsed grant calls; NULL for LLM-scan alerts.';
