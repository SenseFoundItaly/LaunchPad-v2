-- Add trigger_type to monitor_runs so the run log can distinguish how a run
-- was initiated. Mirrors the screenshot reference (Programmato/Manuale/
-- API/Webhook) and lets the detail page filter the history.
--
-- Backfill: existing rows are assumed scheduled — historically every INSERT
-- came from either the cron driver (api/cron) or the manual run endpoint,
-- and we have no signal in the row to disambiguate retroactively. 'scheduled'
-- is the more common origin so it's the safer assumption; the manual-run
-- endpoint will start writing 'manual' from the same deploy that adds this
-- column, so any new manual runs are correctly attributed.

ALTER TABLE monitor_runs
  ADD COLUMN IF NOT EXISTS trigger_type VARCHAR DEFAULT 'scheduled';

-- Defensive: rows inserted between schema-apply and code-deploy will pick
-- up the default. Older rows already have the default by definition.
UPDATE monitor_runs SET trigger_type = 'scheduled' WHERE trigger_type IS NULL;

-- Tight CHECK so we catch typos at write time. Add new origins (e.g. 'slack',
-- 'cli') by updating this constraint in a follow-up migration.
ALTER TABLE monitor_runs
  DROP CONSTRAINT IF EXISTS monitor_runs_trigger_type_check;
ALTER TABLE monitor_runs
  ADD CONSTRAINT monitor_runs_trigger_type_check
  CHECK (trigger_type IN ('scheduled', 'manual', 'api', 'webhook'));

-- The detail page filters runs by (monitor_id, trigger_type) ordered by
-- run_at DESC. The existing run_at index handles the global ordering; this
-- index covers the filtered-by-trigger case efficiently.
CREATE INDEX IF NOT EXISTS idx_monitor_runs_monitor_trigger
  ON monitor_runs(monitor_id, trigger_type, run_at DESC);
