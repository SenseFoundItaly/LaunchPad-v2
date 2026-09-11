-- ============================================================================
-- Migration 011 — Fix double-encoded JSONB in workflow_plans (steps, sources)
-- ============================================================================
-- captureWorkflow used to call JSON.stringify(steps) and JSON.stringify(sources)
-- before binding to the INSERT. postgres.js + `unsafe()` already JSON-encodes
-- arrays for JSONB columns, so the pre-stringification stored a JSONB *string*
-- whose value was the JSON of the array — double-encoded.
--
-- Symptom: `jsonb_typeof(steps)` returned 'string' instead of 'array' on all
-- ~30 historical rows; `jsonb_array_length(steps)` would error.
--
-- Code fix shipped alongside this migration:
--   src/lib/workflow-capture.ts — drop both JSON.stringify calls.
-- Pattern already documented in src/lib/pending-actions.ts:115-118 ("Verified
-- empirically — see commit history").
--
-- This migration converts existing string-encoded rows back to true JSONB
-- arrays in place. Idempotent: WHERE clauses gate the UPDATE so re-running
-- against already-fixed rows is a no-op.
--
-- Cast pattern: `(col #>> '{}')::jsonb` extracts the JSONB-string's textual
-- value (the inner JSON of an array) then re-parses as JSONB → proper array.
-- ============================================================================

BEGIN;

UPDATE workflow_plans
   SET steps = (steps #>> '{}')::jsonb
 WHERE jsonb_typeof(steps) = 'string';

UPDATE workflow_plans
   SET sources = (sources #>> '{}')::jsonb
 WHERE sources IS NOT NULL
   AND jsonb_typeof(sources) = 'string';

COMMIT;
