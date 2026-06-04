-- Migration 007: Pricing department singleton state.
--
-- Pricing is the only department that didn't already own a table when the
-- department model landed. This adds one — mirroring the singleton pattern
-- of `idea_canvas`, `scores`, and `burn_rate` (PRIMARY KEY = project_id,
-- JSONB columns for shape-flexible state, a single updated_at).
--
-- Shape rationale: we keep the *structured* numbers in dedicated columns
-- (anchor_price, currency) so dashboards can read them without parsing JSON,
-- and stash the flexible bits (tiers, WTP estimates, unit-economics inputs)
-- in JSONB so the schema doesn't have to migrate every time we sharpen the
-- pricing model. Qualitative notes still live in memory_facts; this table
-- is for the canonical state Pricing exposes to the rest of the app.

CREATE TABLE IF NOT EXISTS pricing_state (
  project_id    VARCHAR PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,

  -- Anchor: the headline price (e.g. $49/mo) the founder is testing.
  -- NULL until the founder commits to a number.
  anchor_price  DOUBLE PRECISION,
  currency      VARCHAR(3) DEFAULT 'USD',

  -- Tiers: array of { name, price, features[], target_segment } objects.
  -- Free-form so we can evolve the tier model (good/better/best vs.
  -- usage-based vs. seat-based) without a migration each time.
  tiers         JSONB DEFAULT '[]'::jsonb,

  -- Willingness-to-pay research: { method, sample_size, low, p50, high,
  -- notes }. low/p50/high are nullable numbers; method is e.g. "van
  -- westendorp", "interview", "competitor benchmark".
  wtp           JSONB DEFAULT '{}'::jsonb,

  -- Unit economics: { cac, ltv, gross_margin, payback_months }.
  -- Lives here (not in metrics) because pricing decisions are upstream of
  -- these — when pricing changes, these are the first numbers to recompute.
  unit_econ     JSONB DEFAULT '{}'::jsonb,

  -- Model name for downstream context: 'subscription' | 'usage' | 'seat'
  -- | 'one_time' | 'hybrid' | NULL.
  model         VARCHAR,

  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
