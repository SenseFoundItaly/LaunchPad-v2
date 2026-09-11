-- ============================================================================
-- Migration 010 — Drop memory_facts.confidence column
-- ============================================================================
-- Part of the June 2026 Canvas/facts simplification. The confidence column
-- was hardcoded at insert time (0.75 from backfill, 0.8/0.85/1.0 from various
-- code paths) with no real grading. The Canvas UI dropped its display
-- earlier; this migration drops the underlying column.
--
-- All code consumers were removed in the same commit as this migration:
--   - facts.ts:recordFact     — no longer reads/writes the column
--   - facts.ts:listFacts      — `minConfidence` opt deprecated (still accepted, ignored)
--   - intelligence/route.ts   — stopped projecting confidence in facts payload
--   - context.ts              — confidence badge in agent context block removed
--   - context-export/route.ts — confidence dropped from exported JSON
--
-- NOT dropped here (intentionally kept):
--   - memory_facts.reviewed_state — still load-bearing for the /knowledge
--     page's edit/delete flow. Drop after 2 weeks of stable simplified
--     facts pipeline, by which point we'll know if anyone actually uses
--     the apply/reject flow on the dedicated knowledge page.
--   - confidence column on OTHER tables (insight_card via JSONB,
--     tam-sam-som artifacts) — those are content-level confidence and
--     belong with the artifact, not memory_facts.
--
-- Reversibility: this is a one-way door. Backup snapshot recommended before
-- application. To roll back, restore the column from a snapshot and
-- re-introduce the writer code paths.
-- ============================================================================

BEGIN;

ALTER TABLE memory_facts DROP COLUMN IF EXISTS confidence;

COMMIT;

-- End of 010.
