-- Heal legacy `scores` rows onto the 0-100 canon.
--
-- ⚠ EXPECTED TO BE A NO-OP ON PRODUCTION. Census taken 2026-07-31 against the
-- live DB (`ghjbxnnkdketrtmebzxl`), before writing this file:
--
--     total 8 · unscored 3 · junk_zero 0 · ambiguous 0 · canon 5
--
-- Both problem buckets are already empty — prod was healed by hand around
-- 2026-07-22 (issue #252). This migration is therefore DEFENSIVE, not
-- corrective: it exists so the repair is reproducible on the environments that
-- never received it, and so a fresh database is correct by construction.
--
-- Why it is still needed with prod already clean:
--   - staging runs a SEPARATE Supabase project and was never healed;
--   - any restore, fork, or new environment starts from the raw rows;
--   - the only thing protecting readers today is `to100()`
--     (src/lib/score-display.ts) and `baselineScore100`
--     (src/lib/journey/stage-1-idea-validation.ts) masking the shape on the way
--     OUT. Any consumer that reads `scores` directly still sees the legacy value.
--
-- The 15/07 changelog cited #252 as proof the heal shipped; the 2026-07-27 audit
-- found no migration and no script anywhere in the repo. Closing that gap is the
-- point of this file — see the correction appended to
-- docs/changelogs/2026-07-15-alpha-feedback-resolution.md.
--
-- Two legacy shapes, from two eras of the write path:
--   1. Fabricated zeros — dimension-only artifacts used to INSERT
--      overall_score = 0 rather than NULL, so "not scored yet" was stored as
--      "scored, and it's a 0". Home rendered those as 0/100. The write side
--      stopped producing them (artifact-persistence.ts refuses to persist an
--      overall of 0); this repairs what was already there.
--   2. 0-10 rows — chat score-card/gauge artifacts were prompted with
--      maxScore:10 before the scale was unified, so a 7.2 means 72.
--
-- Idempotent: re-running changes nothing, and it stays a no-op against rows
-- written by the current 0-100 path.

-- ── Branch 1: fabricated zeros → NULL ────────────────────────────────────────
-- Unambiguous. 0 is not a reachable score under the current canon (the write
-- path refuses it), so a stored 0 means "never scored" — which is exactly what
-- NULL means, and what the read side already assumes.
UPDATE scores
   SET overall_score = NULL
 WHERE overall_score = 0;

-- ── Branch 2: legacy 0-10 → 0-100 ────────────────────────────────────────────
-- `<= 10` cannot distinguish a legacy 0-10 score of 8 from a legitimate 0-100
-- score of 8, and the anti-sycophancy rubric does emit scores that low (band
-- ≤40 is "serious warning"). That collision is accepted deliberately, for two
-- reasons:
--
--   1. It introduces NO new divergence. `to100()` already applies exactly this
--      rule on every read, so the rendered value is unchanged either way — this
--      only makes the stored value agree with what the app has always shown.
--   2. The 2026-07-31 census found the ambiguous band EMPTY on prod, so no real
--      row is being decided by the guess. On a fresh or restored database the
--      rule is the same one the read path has always used.
--
-- If a future environment turns out to hold genuine sub-10 canon scores, prefer
-- bounding by `scored_at` (the 0-100 unification landed with PR #249 on
-- 2026-07-21) over widening this predicate.
UPDATE scores
   SET overall_score = overall_score * 10
 WHERE overall_score > 0
   AND overall_score <= 10;
