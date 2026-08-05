-- 039 — ICP coherence per interview (Iteration Cycle, Loop 1 signal 3)
--
-- Spec: "Coerenza ICP (profilo intervistati vs ICP definito) — 20% — soglia
-- < 60% match". The spec quantifies the bar in three places and never says how
-- the match is computed.
--
-- Decided (founder, 2026-08-04): an LLM judges `person_segment` against
-- `idea_canvas.target_market` ONCE, the verdict is persisted here, and the
-- journey check + loop signal read THIS COLUMN — never the model. The gates
-- stay deterministic, which is a structural rule of this codebase, and the
-- founder can overturn any judgement.
--
-- Why free text can't be string-matched, from real prod rows:
--   "2-location pizzeria operator"  vs "Independent full-service restaurants,
--   1-3 locations"  -> a human says MATCH, a string comparison says no.
--   "Busy parent — core ICP"        vs "Busy single professionals and young
--   couples" -> the text asserts "core ICP" while the profile contradicts it;
--   any self-declaration heuristic scores this as a match. It is not one.
--
-- NULL means "not judged yet", which is NOT "no match": the coherence rate is
-- computed over judged interviews only, so an unjudged backlog can never look
-- like a failing signal.

ALTER TABLE interviews ADD COLUMN IF NOT EXISTS icp_match BOOLEAN;
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS icp_match_reason TEXT;
-- 'ai' = model judgement, 'founder' = explicitly overturned. The founder's
-- verdict must be distinguishable, and must never be recomputed away.
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS icp_match_source VARCHAR
  CHECK (icp_match_source IS NULL OR icp_match_source IN ('ai', 'founder'));

CREATE INDEX IF NOT EXISTS interviews_project_icp_idx
  ON interviews (project_id, icp_match);

COMMENT ON COLUMN interviews.icp_match IS
  'Does this interviewee match the project ICP? NULL = not judged yet (excluded from the rate, never counted as a miss).';
