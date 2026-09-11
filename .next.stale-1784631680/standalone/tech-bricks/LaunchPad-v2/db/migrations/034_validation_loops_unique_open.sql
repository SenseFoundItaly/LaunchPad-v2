-- 034: one OPEN loop N per project — enforced by the database.
--
-- Numbered 034 (not 032): the shared prod DB already has 032_mvp_builds.sql +
-- 033_allow_mvp_build_iteration_action_type.sql applied from the Build-Hub
-- work (PR #218, unmerged). Those files aren't on this branch, so 032/033 are
-- a deliberate gap here — they slot in when #218 merges, this follows.
--
-- 2026-07-10 audit (INV2): openLoop1() → INSERT in maybeTriggerLoop1 is a
-- check-then-insert with no transaction, and 031's idx is NON-unique — two
-- concurrent interview POSTs (double-submit, multi-instance serverless) can
-- both find no open loop and both insert a 'proposed' Loop-1 row. The code
-- path stays as-is; this partial UNIQUE index turns the race's loser into a
-- constraint error the existing catch-and-warn handling absorbs.
--
-- Defensive pre-step: if the race already produced duplicates, close every
-- open row but the EARLIEST per (project, loop) so the index can build.
-- (closed_at stamped; verdict left NULL — same shape as an override-close.)

UPDATE validation_loops v
SET status = 'closed', closed_at = CURRENT_TIMESTAMP
WHERE v.status IN ('proposed', 'active', 'in_review')
  AND EXISTS (
    SELECT 1 FROM validation_loops w
    WHERE w.project_id = v.project_id
      AND w.loop_number = v.loop_number
      AND w.status IN ('proposed', 'active', 'in_review')
      AND (w.created_at < v.created_at
           OR (w.created_at = v.created_at AND w.id < v.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_validation_loops_one_open
  ON validation_loops(project_id, loop_number)
  WHERE status IN ('proposed', 'active', 'in_review');
