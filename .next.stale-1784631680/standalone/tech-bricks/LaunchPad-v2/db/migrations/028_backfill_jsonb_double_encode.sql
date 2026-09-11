-- Backfill JSONB columns historically written DOUBLE-ENCODED (audit #142).
--
-- `JSON.stringify(x)` bound into a jsonb column stores a JSON *string* scalar
-- (jsonb_typeof = 'string') instead of the array/object — consumers then can't
-- read it. The write-side is fixed in the same change (raw binds); this repairs
-- existing rows. Each UPDATE only touches string-typed values, so it is safe and
-- idempotent (clean array/object rows are skipped). `col #>> '{}'` extracts the
-- underlying JSON text, which `::jsonb` re-parses into the real value.
-- See src/lib/jsonb.ts.
UPDATE pitch_versions    SET slides           = (slides           #>> '{}')::jsonb WHERE jsonb_typeof(slides)           = 'string';
UPDATE pitch_versions    SET changelog        = (changelog        #>> '{}')::jsonb WHERE jsonb_typeof(changelog)        = 'string';
UPDATE investors         SET tags             = (tags             #>> '{}')::jsonb WHERE jsonb_typeof(tags)             = 'string';
UPDATE growth_iterations SET proposed_changes = (proposed_changes #>> '{}')::jsonb WHERE jsonb_typeof(proposed_changes) = 'string';
UPDATE startup_updates   SET metrics_snapshot = (metrics_snapshot #>> '{}')::jsonb WHERE jsonb_typeof(metrics_snapshot) = 'string';
UPDATE startup_updates   SET highlights       = (highlights       #>> '{}')::jsonb WHERE jsonb_typeof(highlights)       = 'string';
UPDATE startup_updates   SET challenges       = (challenges       #>> '{}')::jsonb WHERE jsonb_typeof(challenges)       = 'string';
UPDATE startup_updates   SET asks             = (asks             #>> '{}')::jsonb WHERE jsonb_typeof(asks)             = 'string';
UPDATE monitors          SET config           = (config           #>> '{}')::jsonb WHERE jsonb_typeof(config)           = 'string';
UPDATE monitors          SET urls_to_track    = (urls_to_track    #>> '{}')::jsonb WHERE jsonb_typeof(urls_to_track)    = 'string';
UPDATE monitors          SET sources          = (sources          #>> '{}')::jsonb WHERE jsonb_typeof(sources)         = 'string';
