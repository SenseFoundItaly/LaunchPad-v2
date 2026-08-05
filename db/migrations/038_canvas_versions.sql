-- 038 — Idea Canvas versioning (Iteration Cycle, Loop 1 output)
--
-- Spec, "Output del Loop" (Loop 1):
--   "PSF vN: ICP, value prop, problem statement aggiornati — persistiti in
--    Knowledge con versioning"
--   "Diff visuale v1/v2: visualizzazione esplicita di cosa è cambiato e perché"
--
-- `idea_canvas` is ONE row per project, overwritten in place. After a Loop-1
-- pivot the founder's original framing is gone — so "Solution described
-- in-depth" and "Value proposition sharpened" (both 1C steps) are
-- indistinguishable from the canvas they started with, and the mandated v1/v2
-- diff cannot be rendered at all.
--
-- Shape mirrors pitch_versions (version_number + jsonb payload + changelog),
-- which is the established versioning pattern in this schema.
--
-- `reason` records WHY the snapshot was taken (loop_1_open, loop_1_close, …) —
-- the spec asks the diff to show "cosa è cambiato E PERCHÉ", so the why has to
-- be stored at capture time; it cannot be reconstructed later.

CREATE TABLE IF NOT EXISTS canvas_versions (
  id             VARCHAR PRIMARY KEY,
  project_id     VARCHAR NOT NULL,
  version_number INTEGER NOT NULL,
  -- Full canvas payload at capture time. Bind the RAW object — JSON.stringify
  -- double-encodes into a string scalar and every ->> read returns null.
  canvas         JSONB   NOT NULL,
  reason         VARCHAR NOT NULL,
  /** Loop that triggered the snapshot, when there was one. */
  loop_id        VARCHAR,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One version number per project; the writer reads MAX(version_number)+1, so a
-- unique index is the concurrency gate (same discipline as
-- 034_validation_loops_unique_open).
CREATE UNIQUE INDEX IF NOT EXISTS canvas_versions_project_version_uniq
  ON canvas_versions (project_id, version_number);

CREATE INDEX IF NOT EXISTS canvas_versions_project_created_idx
  ON canvas_versions (project_id, created_at DESC);

COMMENT ON TABLE canvas_versions IS
  'Idea Canvas snapshots for the Loop-1 v1/v2 diff. One row per captured version; canvas holds the full field set at that moment.';
