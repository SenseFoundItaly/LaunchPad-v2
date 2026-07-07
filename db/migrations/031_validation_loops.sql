-- 031: validation_loops — the L2 Loop layer substrate (walkthrough §4-5, §8).
--
-- The loops are the differentiator of L2 ("il motivo per cui L2 esiste come
-- sistema e non come semplice checklist"). ONE table serves all four loops;
-- `loop_number` discriminates. Loop 1 (PSF Review) is the first consumer.
--
-- Every loop has the three spec-mandated characteristics, stored here:
--   - loop_score   : the OBJECTIVE trigger evidence [{signal,value,threshold,passed}]
--   - scope        : the steps to revise (ValidationTarget[]) — surgical/delta, not reset
--   - iteration/cap: escalation cap (caps live in code); at the cap a verdict is forced
--   - verdict      : GO | PIVOT | STOP (set only at the cap, founder-picked)
--   - trigger      : 'auto' (objective) or 'manual' (founder override) — both mandatory
--   - override_motivation : founder ignored the auto-trigger, reason recorded (§4/§8)
--
-- Founder-first: a row is only ever PROPOSED by the system; nothing loops,
-- reverts, or blocks until the founder acts.

CREATE TABLE IF NOT EXISTS validation_loops (
  id TEXT PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  loop_number INT NOT NULL CHECK (loop_number BETWEEN 1 AND 4),
  iteration INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'active', 'in_review', 'closed')),
  trigger TEXT NOT NULL DEFAULT 'auto' CHECK (trigger IN ('auto', 'manual')),
  loop_score JSONB DEFAULT '[]'::jsonb,
  scope JSONB DEFAULT '[]'::jsonb,
  verdict TEXT CHECK (verdict IN ('GO', 'PIVOT', 'STOP')),
  verdict_evidence JSONB,
  override_motivation TEXT,
  pending_action_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  closed_at TIMESTAMP
);

-- One lookup pattern dominates: "is there an OPEN loop N for this project?"
CREATE INDEX IF NOT EXISTS idx_validation_loops_project_open
  ON validation_loops(project_id, loop_number, status);
