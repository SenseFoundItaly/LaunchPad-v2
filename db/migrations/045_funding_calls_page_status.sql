-- 045 — funding_calls page status: make "what could NOT be fetched" visible.
--
-- The grants page must say, per call, whether the official page was read
-- (Lombardia detail pages carry the closing hour + eligibility; they are
-- fetched a bounded number per day), could not be read (portal 404/5xx,
-- timeout, or its "Errore" page for an unknown codice), or does not apply
-- (SEDIA: everything comes from the API, there is no page to read).
--
--   page_status: unread | ok | failed | n/a
--   page_error:  the reason for 'failed' (e.g. 'HTTP 404', 'Errore page')
--   page_checked_at: when the page was last attempted (NULL while unread)
--
-- Sync rule (src/lib/grants/sync.ts): an incoming 'unread' never overwrites a
-- stored ok/failed — a Socrata-only pass must not erase what a detail fetch
-- established. Additive + idempotent.

ALTER TABLE funding_calls
  ADD COLUMN IF NOT EXISTS page_status VARCHAR NOT NULL DEFAULT 'unread'
  CHECK (page_status IN ('unread', 'ok', 'failed', 'n/a'));
ALTER TABLE funding_calls ADD COLUMN IF NOT EXISTS page_error TEXT;
ALTER TABLE funding_calls ADD COLUMN IF NOT EXISTS page_checked_at TIMESTAMP;

-- Backfill: SEDIA rows are API-sourced; Lombardia rows already enriched were read OK.
UPDATE funding_calls SET page_status = 'n/a'
 WHERE source = 'sedia' AND page_status = 'unread';
UPDATE funding_calls SET page_status = 'ok', page_checked_at = COALESCE(page_checked_at, last_verified_at)
 WHERE source = 'lombardia' AND eligibility_text IS NOT NULL AND page_status = 'unread';
