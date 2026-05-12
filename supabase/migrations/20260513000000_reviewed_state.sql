-- Migration: Add reviewed_state to knowledge/intelligence tables
-- Replaces the boolean `dismissed` on memory_facts with a richer state machine.
-- Adds reviewed_state to graph_nodes and tabular_reviews.
--
-- States: 'pending' (awaiting founder review), 'approved' (active in context),
--         'rejected' (hidden from agent, visible in audit trail).

-- =============================================================================
-- 1. memory_facts: dismissed → reviewed_state
-- =============================================================================

ALTER TABLE memory_facts
  ADD COLUMN IF NOT EXISTS reviewed_state VARCHAR DEFAULT 'pending';

-- Backfill: dismissed=true → 'rejected', dismissed=false → 'approved'
-- (existing data is trusted — no inbox flood on deploy)
UPDATE memory_facts SET reviewed_state = 'rejected' WHERE dismissed = true;
UPDATE memory_facts SET reviewed_state = 'approved' WHERE dismissed = false;

-- Drop the old column
ALTER TABLE memory_facts DROP COLUMN IF EXISTS dismissed;

-- Replace the old composite index with one that uses reviewed_state
DROP INDEX IF EXISTS idx_memory_facts_user_project;
CREATE INDEX idx_memory_facts_user_project
  ON memory_facts(user_id, project_id, reviewed_state, updated_at DESC);

-- Partial index for the hot path: agent context only reads approved facts
CREATE INDEX idx_memory_facts_approved
  ON memory_facts(user_id, project_id, updated_at DESC)
  WHERE reviewed_state = 'approved';

-- =============================================================================
-- 2. graph_nodes: add reviewed_state
-- =============================================================================

ALTER TABLE graph_nodes
  ADD COLUMN IF NOT EXISTS reviewed_state VARCHAR DEFAULT 'pending';

-- Existing nodes are trusted
UPDATE graph_nodes SET reviewed_state = 'approved' WHERE reviewed_state IS NULL OR reviewed_state = 'pending';

-- Partial index for context queries
CREATE INDEX idx_graph_nodes_approved
  ON graph_nodes(project_id)
  WHERE reviewed_state = 'approved';

-- =============================================================================
-- 3. tabular_reviews: add reviewed_state
-- =============================================================================

ALTER TABLE tabular_reviews
  ADD COLUMN IF NOT EXISTS reviewed_state VARCHAR DEFAULT 'pending';

-- Existing reviews are trusted
UPDATE tabular_reviews SET reviewed_state = 'approved' WHERE reviewed_state IS NULL OR reviewed_state = 'pending';
