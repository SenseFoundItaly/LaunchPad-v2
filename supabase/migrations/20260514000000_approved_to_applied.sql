-- Migration: Rename 'approved' → 'applied' across all status/state columns.
--
-- The platform vocabulary changed from "approve" to "apply" — the founder
-- "applies" proposals rather than "approving" them. This migration brings
-- persisted data in line with the new codebase literals.

-- =============================================================================
-- 1. pending_actions.status
-- =============================================================================
UPDATE pending_actions SET status = 'applied' WHERE status = 'approved';

-- =============================================================================
-- 2. graph_nodes.reviewed_state
-- =============================================================================
UPDATE graph_nodes SET reviewed_state = 'applied' WHERE reviewed_state = 'approved';

-- =============================================================================
-- 3. memory_facts.reviewed_state
-- =============================================================================
UPDATE memory_facts SET reviewed_state = 'applied' WHERE reviewed_state = 'approved';

-- =============================================================================
-- 4. tabular_reviews.reviewed_state
-- =============================================================================
UPDATE tabular_reviews SET reviewed_state = 'applied' WHERE reviewed_state = 'approved';

-- =============================================================================
-- 5. memory_events.event_type
-- =============================================================================
UPDATE memory_events SET event_type = REPLACE(event_type, '_approved', '_applied')
  WHERE event_type LIKE '%_approved';

-- =============================================================================
-- 6. Recreate partial indexes with new predicate
-- =============================================================================
DROP INDEX IF EXISTS idx_memory_facts_approved;
CREATE INDEX IF NOT EXISTS idx_memory_facts_applied
  ON memory_facts(user_id, project_id, updated_at DESC)
  WHERE reviewed_state = 'applied';

DROP INDEX IF EXISTS idx_graph_nodes_approved;
CREATE INDEX IF NOT EXISTS idx_graph_nodes_applied
  ON graph_nodes(project_id)
  WHERE reviewed_state = 'applied';
