-- Migration 018: enforce one graph_node per (project_id, LOWER(name))
-- ============================================================================
-- THE RACE THIS FIXES
-- --------------------------------------------------------------------------
-- acceptAlertIntoKnowledge() and the proposed_graph_update entity-card path in
-- src/lib/action-executors.ts upserted graph_nodes with a non-atomic
-- "SELECT ... WHERE LOWER(name)=LOWER(?)  then  INSERT-if-missing" pattern and
-- NO backing unique constraint. On the production pgbouncer pooler (transaction
-- pooling mode) consecutive queries from one logical request can land on
-- different backend connections, so within a batch of same-entity accepts,
-- accept #2's SELECT can run before accept #1's INSERT is visible to it. Both
-- then INSERT, producing byte-identical duplicate nodes. Observed in vivo:
-- 3 accepts of entity "AI Plant Doctor" produced 2 identical graph_nodes.
--
-- The application code is being changed to a single atomic
--   INSERT ... ON CONFLICT (project_id, LOWER(name)) DO UPDATE ...
-- which REQUIRES the expression unique index created at the end of this file.
--
-- This migration is idempotent and safe to re-run against PRODUCTION data that
-- ALREADY contains duplicates: it first dedups, repoints every foreign-key
-- reference onto the surviving "keeper" row, deletes the losers, then creates
-- the unique index.
--
-- KEEPER rule: per (project_id, LOWER(name)) group, keep the EARLIEST row
-- (lowest created_at, tie-broken by lowest id). All other rows in the group are
-- "duplicates" that get their inbound FKs repointed to the keeper, then deleted.
--
-- FK columns that reference graph_nodes.id (verified against db/schema.sql and a
-- codebase grep on 2026-06-11):
--   * graph_edges.source_node_id   (ON DELETE CASCADE)
--   * graph_edges.target_node_id   (ON DELETE CASCADE)
--   * ecosystem_alerts.graph_node_id (ON DELETE SET NULL)
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Map every graph_node id to the keeper id of its (project_id, LOWER(name))
--    group. Rows that are already the keeper map to themselves. This temp table
--    is dropped at COMMIT (ON COMMIT DROP) so the whole migration stays
--    re-runnable.
-- --------------------------------------------------------------------------
CREATE TEMP TABLE _gn_dedup_map ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    project_id,
    created_at,
    FIRST_VALUE(id) OVER (
      PARTITION BY project_id, LOWER(name)
      ORDER BY created_at ASC, id ASC
    ) AS keeper_id
  FROM graph_nodes
)
SELECT id AS dup_id, keeper_id
FROM ranked
WHERE id <> keeper_id;   -- only the losers; keepers omitted

-- --------------------------------------------------------------------------
-- 1. Repoint graph_edges.source_node_id from a duplicate onto its keeper.
--    A repoint can collapse two distinct edges into the same logical edge
--    (project_id, source_node_id, target_node_id, relation) — the app's edge
--    identity (see src/app/api/graph/[projectId]/edges/route.ts). To avoid a
--    redundant row, FIRST delete any edge whose source would, post-repoint,
--    duplicate an existing keeper-sourced edge; THEN update the survivors.
-- --------------------------------------------------------------------------
DELETE FROM graph_edges e
USING _gn_dedup_map m
WHERE e.source_node_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM graph_edges k
    WHERE k.project_id = e.project_id
      AND k.source_node_id = m.keeper_id
      AND k.target_node_id = e.target_node_id
      AND k.relation = e.relation
  );

UPDATE graph_edges e
SET source_node_id = m.keeper_id
FROM _gn_dedup_map m
WHERE e.source_node_id = m.dup_id;

-- --------------------------------------------------------------------------
-- 2. Same treatment for graph_edges.target_node_id.
-- --------------------------------------------------------------------------
DELETE FROM graph_edges e
USING _gn_dedup_map m
WHERE e.target_node_id = m.dup_id
  AND EXISTS (
    SELECT 1 FROM graph_edges k
    WHERE k.project_id = e.project_id
      AND k.source_node_id = e.source_node_id
      AND k.target_node_id = m.keeper_id
      AND k.relation = e.relation
  );

UPDATE graph_edges e
SET target_node_id = m.keeper_id
FROM _gn_dedup_map m
WHERE e.target_node_id = m.dup_id;

-- --------------------------------------------------------------------------
-- 2b. A repoint of BOTH endpoints onto the same keeper would create a
--     self-loop (source = target). Drop any such degenerate edge — it carries
--     no information and was an artifact of the duplication, not real data.
-- --------------------------------------------------------------------------
DELETE FROM graph_edges
WHERE source_node_id = target_node_id;

-- --------------------------------------------------------------------------
-- 3. Repoint ecosystem_alerts.graph_node_id from a duplicate onto its keeper.
--    (No uniqueness constraint here — a plain UPDATE is sufficient.)
-- --------------------------------------------------------------------------
UPDATE ecosystem_alerts a
SET graph_node_id = m.keeper_id
FROM _gn_dedup_map m
WHERE a.graph_node_id = m.dup_id;

-- --------------------------------------------------------------------------
-- 4. All inbound FKs now point at keepers. Delete the duplicate nodes.
-- --------------------------------------------------------------------------
DELETE FROM graph_nodes g
USING _gn_dedup_map m
WHERE g.id = m.dup_id;

-- --------------------------------------------------------------------------
-- 5. Enforce the invariant going forward. The expression must be written
--    EXACTLY as (project_id, LOWER(name)) so the application's
--    INSERT ... ON CONFLICT (project_id, LOWER(name)) matches this index.
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS graph_nodes_project_lower_name_uniq
  ON graph_nodes (project_id, LOWER(name));

COMMIT;
