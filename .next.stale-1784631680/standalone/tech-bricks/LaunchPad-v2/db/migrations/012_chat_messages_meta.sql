-- Iteration 3 / WS-A — add `meta` JSONB column to chat_messages for
-- per-turn violation flags (skill_first_violation, prose_fabrication, ...).
-- See design doc mikececconello-launchpad-v2-project-design-20260607-222823.md.
--
-- The column defaults to {} so all existing rows are valid post-migration.
-- The chat route reads `meta` defensively (treats missing/null as {}), so
-- older deployments without this migration degrade gracefully.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

-- Helpful index for future analytics queries that filter by violation flags.
-- Partial index keeps the index small — most rows have meta = '{}'.
CREATE INDEX IF NOT EXISTS chat_messages_violations_idx
  ON chat_messages ((meta -> 'skill_first_violation'))
  WHERE meta ? 'skill_first_violation';

CREATE INDEX IF NOT EXISTS chat_messages_fabrication_idx
  ON chat_messages ((meta -> 'prose_fabrication'))
  WHERE meta ? 'prose_fabrication';
