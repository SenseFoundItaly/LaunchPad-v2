-- ============================================================================
-- 022: competitor_categories — the "matryoshka" breakdown for item 14
-- ----------------------------------------------------------------------------
-- Changelog 17/06 item 14: a competitor in the graph should decompose into
-- CATEGORIES (general, product, pricing, distribution, marketing, competitive
-- advantage, criticality) so the founder can open a competitor and see each
-- dimension in detail — startup → competitor → category → detail.
--
-- Competitors are already graph_nodes (node_type='competitor', persisted
-- 'pending' since ca75b78 — founder-approval-gated, no auto-apply). This table
-- hangs the per-category detail off that node WITHOUT multiplying graph_nodes
-- or approval rows. Additive + non-destructive.
--
-- NOTE: apply with `npm run db:migrate` (review the target DB first — the dev
-- DATABASE_URL may point at prod). The companion TS lives in
-- src/lib/competitor-categories.ts.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS competitor_categories (
  id VARCHAR PRIMARY KEY,
  project_id VARCHAR NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  competitor_node_id VARCHAR NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  category VARCHAR NOT NULL,
  detail TEXT NOT NULL,
  sources JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_competitor_categories_project
  ON competitor_categories(project_id);

-- One row per (competitor, category): re-analysis UPSERTs the detail in place
-- instead of duplicating, so the matryoshka stays clean over time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_competitor_categories_node_cat
  ON competitor_categories(competitor_node_id, category);

COMMIT;
