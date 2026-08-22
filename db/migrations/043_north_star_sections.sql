-- 043 — the seven sections, and the risk attached to each.
--
-- The lite kickoff already writes five headline pillars (042). This adds the
-- long form: seven sections that a founder would otherwise fill by hand over
-- weeks, plus the thing that makes them worth trusting — every section carries
-- the RISK that would make it wrong, and where its content actually came from.
--
-- One JSONB column, not seven, and not a row per section:
--   * a section is only ever read and written as a whole document
--   * the set of sections is product copy, not data — adding an eighth must not
--     need a migration
--   * `sections || EXCLUDED.sections` merges, so the agent can fill several in
--     one turn without the writes clobbering each other
--
-- Shape, per key (see src/lib/kickoff/sections.ts, which is the contract):
--   { "customer": { "text": "...", "risk": "...", "confidence": "grounded",
--                   "updatedAt": "2026-08-22T…" } }
--
-- Still NOT evidence. No gate check reads this table, `buildProjectSnapshot`
-- does not select it, and nothing here turns a validation substep green. It is
-- a draft the founder can promote with a click — `isolation.test.ts` asserts
-- every clause of that sentence.

ALTER TABLE north_star
  ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '{}'::jsonb;
