-- 042 — the North Star draft document (Launchpad Lite kickoff)
--
-- A SEPARATE TABLE, deliberately. The whole safety property of the lite
-- kickoff is that the agent writes these pillars LIVE, with no approval card,
-- while the product's headline invariant still holds:
--
--   "any evidence YOU produce that would satisfy a validation substep MUST be
--    staged for approval — you can NEVER write it silently"  (chat/route.ts)
--
-- Both are true at once only because NO GATE CHECK READS THIS TABLE. It is a
-- draft document, not evidence. Promoting a pillar into `idea_canvas` is a
-- separate, founder-clicked act, and THAT is the consent moment.
--
-- Putting it in its own table rather than on `idea_canvas` or in
-- `projects.settings` is the point: the separation should be visible in the
-- schema, so the next person cannot blur it by accident.
-- `src/lib/kickoff/isolation.test.ts` asserts the property holds.
--
-- Numbering: 042 taken from `_migrations` in the live DB (highest applied:
-- 041_market_size_fact_kind), NEVER from the file tree — 040 is already
-- duplicated there, which is exactly the failure that rule prevents.

CREATE TABLE IF NOT EXISTS north_star (
  project_id  VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  -- { "01": "…", "02": "…", … } — pillar id → the founder-facing text.
  pillars     JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- pillar id → ISO timestamp it was promoted into idea_canvas. Absent = draft
  -- only. This is the audit trail of the consent moment.
  promoted    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
