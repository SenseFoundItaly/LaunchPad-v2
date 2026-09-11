-- 030: Lean Canvas "Channels" block (L2 spec Phase 0, step 6 — "Acquisition
-- channels identified"). TEXT like the other core canvas fields so it rides
-- the existing canvas_field validation-gate path unchanged.
ALTER TABLE idea_canvas ADD COLUMN IF NOT EXISTS channels TEXT;
