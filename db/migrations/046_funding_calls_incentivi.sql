-- 046 — incentivi.gov.it (MIMIT's national catalogue) as a third funding
-- source, plus the region/facet columns its records carry.
--
-- Why: the catalogue's public Solr index returns every national AND regional
-- incentive in one call (~5,800 records, ~830 open/rolling, all 20 regions
-- tagged by name, typed open/close dates, official links, "A chi si rivolge"
-- eligibility text). One connector covers every Italian region; the direct
-- Lombardia feed stays because the catalogue misses most provincial calls.
--
--   regions      TEXT[]  region names as the source tags them; NULL for SEDIA
--   facets       JSONB   { subject_types, scopes, support_forms, ateco, national }
--                        — the relevance layer's structured inputs
--   source_note  TEXT    the source's free-text closing note ("chiusura ad
--                        esaurimento risorse") — shown, NEVER parsed for dates
--   catalog_url  VARCHAR the catalogue entry; official_url stays the granting
--                        body's own page
-- Additive + idempotent (DROP IF EXISTS before re-adding the CHECKs).

ALTER TABLE funding_calls DROP CONSTRAINT IF EXISTS funding_calls_source_check;
ALTER TABLE funding_calls ADD CONSTRAINT funding_calls_source_check
  CHECK (source IN ('sedia', 'lombardia', 'incentivi'));
ALTER TABLE funding_source_state DROP CONSTRAINT IF EXISTS funding_source_state_source_check;
ALTER TABLE funding_source_state ADD CONSTRAINT funding_source_state_source_check
  CHECK (source IN ('sedia', 'lombardia', 'incentivi'));

ALTER TABLE funding_calls ADD COLUMN IF NOT EXISTS regions     TEXT[];
ALTER TABLE funding_calls ADD COLUMN IF NOT EXISTS facets      JSONB;
ALTER TABLE funding_calls ADD COLUMN IF NOT EXISTS source_note TEXT;
ALTER TABLE funding_calls ADD COLUMN IF NOT EXISTS catalog_url VARCHAR;
CREATE INDEX IF NOT EXISTS idx_funding_calls_regions ON funding_calls USING GIN (regions);

INSERT INTO funding_source_state (source) VALUES ('incentivi') ON CONFLICT (source) DO NOTHING;
