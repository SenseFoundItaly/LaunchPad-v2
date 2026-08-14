-- 040 — the interview PIPELINE, not just the interview (#398, Iteration Cycle 1C)
--
-- Three of the seven 1C artifact steps are states of ONE record, not three
-- tables: "cold users listed" → "cold users outreach" → the interview itself.
-- The table could only hold the last of those, because `summary` is NOT NULL —
-- and a prospect you have not spoken to yet has nothing to summarise. So the
-- first two steps had no row to count and were permanently red.
--
-- `status`: listed | contacted | scheduled | done.
--
-- NULL is read as 'done' everywhere in code, deliberately: every writer that
-- existed before this migration (log_interview, the upload digest, POST
-- /interviews) creates a CONDUCTED interview, so a row that never says
-- otherwise is one. The backfill below makes that explicit for the 84 rows in
-- prod rather than leaving them to the reader's default.
--
-- Numbering: 040, not 038/039 — those are taken, and 037 is already used TWICE
-- (037_gate_verdict + 037_mvp_build_issues from PR #218). Check `_migrations`
-- before picking a number, never the file tree.

ALTER TABLE interviews ALTER COLUMN summary DROP NOT NULL;

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS status VARCHAR;

-- Everything that exists today was a conducted interview. Run BEFORE any code
-- can create a prospect row, so no historical row is ever mistaken for one.
UPDATE interviews SET status = 'done' WHERE status IS NULL;

-- The gate counts prospects per project constantly; 84 rows today, but the
-- check runs on every snapshot build.
CREATE INDEX IF NOT EXISTS idx_interviews_project_status ON interviews (project_id, status);
