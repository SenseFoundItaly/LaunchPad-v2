-- ============================================================================
-- Migration 008 — Unify the proposal surface
-- ============================================================================
-- Status: AUTHORIZED FOR APPLICATION. User approved on 2026-06-03 as part of
-- the consolidation push. Each BEGIN/COMMIT block stands alone so a single
-- chunk failure won't leave the schema half-migrated. The DROP/CASCADE lines
-- in §5 remain commented for a later release.
--
-- Goal: collapse the 5 "proposal-shaped" tables into a single inbox
-- backbone, so /inbox is the only review surface a founder sees.
--
-- BEFORE                                                       AFTER
--   pending_actions       (213 rows, active)                    pending_actions
--   ecosystem_alerts      (4 rows, materialized in Phase 1)     (signal_alert, intelligence_brief,
--   intelligence_briefs   (3 rows, materialized in Phase 1)      assumption_review subsume these)
--   source_changes        (5 rows, raw scrape diffs)            ↳ raw_change action_type
--   signal_activity_logs  (30 rows, replaced by pa.status)      DROPPED
--   competitor_profiles   (6 rows, fold into graph_nodes)       graph_nodes(node_type='competitor')
--   assumptions           (missing live; fold into memory_facts) memory_facts(kind='assumption')
--   tabular_cells         (0 rows)                              DROPPED
--   tabular_reviews       (1 row — fold into chat artifact)     DROPPED
--   + the 18 truly-dead 0-row tables                            DROPPED
--
-- Strategy:
--   1. Add the columns the unified store needs (kind, status, source_ref).
--   2. Backfill from each side table into pending_actions / memory_facts /
--      graph_nodes — copy, don't move, so rollback is safe.
--   3. Add an UPDATE trigger keeping side tables in sync until producers
--      are rewritten (idempotency belt-and-suspenders).
--   4. After producer cutover (separate PR), DROP the side tables.
--
-- Each step is wrapped in BEGIN/COMMIT so a partial failure doesn't leave
-- a half-applied schema.
-- ============================================================================

BEGIN;

-- ─── 1a. pending_actions can already hold the new kinds; no schema change ───
-- The TypeScript enum was extended (see src/types/index.ts). VARCHAR columns
-- accept the new strings without DDL. We add a CHECK to lock the union.
ALTER TABLE pending_actions
  DROP CONSTRAINT IF EXISTS pending_actions_action_type_check;
ALTER TABLE pending_actions
  ADD CONSTRAINT pending_actions_action_type_check
  CHECK (action_type IN (
    'draft_email', 'draft_linkedin_post', 'draft_linkedin_dm',
    'proposed_hypothesis', 'proposed_interview_question', 'proposed_landing_copy',
    'proposed_investor_followup', 'proposed_graph_update',
    'workflow_step', 'configure_monitor', 'configure_budget',
    'configure_watch_source', 'skill_rerun_result', 'task',
    -- Unified-inbox additions:
    'signal_alert', 'intelligence_brief', 'assumption_review', 'raw_change'
  ));

-- ─── 1b. Generic source-ref column on pending_actions ────────────────────────
-- Today we only have `ecosystem_alert_id`. Add a generic pair so any source
-- table can be referenced uniformly. The existing ecosystem_alert_id column
-- stays for backward compat; new producers should use the generic pair.
ALTER TABLE pending_actions
  ADD COLUMN IF NOT EXISTS source_table VARCHAR,
  ADD COLUMN IF NOT EXISTS source_id    VARCHAR;
CREATE INDEX IF NOT EXISTS idx_pending_actions_source
  ON pending_actions(project_id, source_table, source_id);

COMMIT;

-- ─── 2. Backfill side tables into pending_actions ───────────────────────────
-- Idempotent: NOT EXISTS guard on each source key.
BEGIN;

-- 2a. ecosystem_alerts → pending_actions(signal_alert)
INSERT INTO pending_actions
  (id, project_id, ecosystem_alert_id, source_table, source_id,
   action_type, title, rationale, payload, status, priority, sources,
   created_at, updated_at)
SELECT
  'pa_ea_' || substr(md5(ea.id), 1, 12),
  ea.project_id,
  ea.id,
  'ecosystem_alerts',
  ea.id,
  'signal_alert',
  ea.headline,
  LEFT(COALESCE(ea.body, ''), 500),
  jsonb_build_object(
    'alert_type', ea.alert_type,
    'source', ea.source,
    'source_url', ea.source_url,
    'relevance_score', ea.relevance_score
  ),
  CASE COALESCE(ea.reviewed_state, 'pending')
    WHEN 'accepted' THEN 'applied'
    WHEN 'rejected' THEN 'rejected'
    WHEN 'dismissed' THEN 'rejected'
    ELSE 'pending'
  END,
  CASE
    WHEN ea.relevance_score >= 0.85 THEN 'critical'
    WHEN ea.relevance_score >= 0.70 THEN 'high'
    WHEN ea.relevance_score >= 0.50 THEN 'medium'
    ELSE 'low'
  END,
  CASE WHEN ea.source_url IS NOT NULL
       THEN jsonb_build_array(jsonb_build_object('type', 'web', 'title', ea.source, 'url', ea.source_url))
       ELSE NULL
  END,
  ea.created_at,
  COALESCE(ea.reviewed_at, ea.created_at)
FROM ecosystem_alerts ea
WHERE NOT EXISTS (
  SELECT 1 FROM pending_actions pa
   WHERE pa.ecosystem_alert_id = ea.id
);

-- 2b. intelligence_briefs → pending_actions(intelligence_brief)
INSERT INTO pending_actions
  (id, project_id, source_table, source_id, action_type, title, rationale,
   payload, status, priority, created_at, updated_at)
SELECT
  'pa_ib_' || substr(md5(ib.id), 1, 12),
  ib.project_id,
  'intelligence_briefs',
  ib.id,
  'intelligence_brief',
  ib.title,
  LEFT(COALESCE(ib.narrative, ''), 500),
  jsonb_build_object(
    'brief_id', ib.id,
    'entity', ib.entity_name,
    'narrative', ib.narrative,
    'prediction', ib.temporal_prediction,
    'confidence', ib.confidence,
    'signal_count', ib.signal_count,
    'recommended_actions', ib.recommended_actions
  ),
  CASE COALESCE(ib.status, 'active')
    WHEN 'reviewed'  THEN 'applied'
    WHEN 'dismissed' THEN 'rejected'
    ELSE 'pending'
  END,
  CASE
    WHEN ib.confidence >= 0.85 THEN 'high'
    WHEN ib.confidence >= 0.65 THEN 'medium'
    ELSE 'low'
  END,
  ib.created_at,
  ib.created_at
FROM intelligence_briefs ib
WHERE NOT EXISTS (
  SELECT 1 FROM pending_actions pa
   WHERE pa.action_type = 'intelligence_brief'
     AND pa.source_id = ib.id
);

-- 2c. source_changes → pending_actions(raw_change)
-- Only "significant" changes worth surfacing; low-significance scrapes stay
-- in the source table for diffing but don't pollute the inbox.
INSERT INTO pending_actions
  (id, project_id, source_table, source_id, action_type, title, rationale,
   payload, status, priority, created_at, updated_at)
SELECT
  'pa_sc_' || substr(md5(sc.id), 1, 12),
  sc.project_id,
  'source_changes',
  sc.id,
  'raw_change',
  COALESCE(sc.diff_summary, 'Source updated'),
  sc.significance_rationale,
  jsonb_build_object(
    'watch_source_id', sc.watch_source_id,
    'significance', sc.significance,
    'detected_at', sc.detected_at
  ),
  'pending',
  CASE sc.significance
    WHEN 'high'   THEN 'high'
    WHEN 'medium' THEN 'medium'
    ELSE 'low'
  END,
  sc.detected_at,
  sc.detected_at
FROM source_changes sc
WHERE sc.significance IN ('high', 'medium')
  AND NOT EXISTS (
    SELECT 1 FROM pending_actions pa
     WHERE pa.action_type = 'raw_change' AND pa.source_id = sc.id
  );

COMMIT;

-- ─── 3. competitor_profiles → graph_nodes(node_type='competitor') ───────────
-- competitor_profiles is a small dedicated table that duplicates what a
-- graph_node of type 'competitor' already represents. Collapse into the graph.
-- Live columns (verified 2026-06-03): id, project_id, name, slug, description,
-- signal_counts, total_signals, latest_brief_id, trend_direction,
-- last_activity_at, metadata, created_at, updated_at.
BEGIN;

INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state, created_at)
SELECT
  'gn_cp_' || substr(md5(cp.id), 1, 12),
  cp.project_id,
  cp.name,
  'competitor',
  cp.description,
  jsonb_build_object(
    'origin', 'competitor_profiles',
    'slug', cp.slug,
    'signal_counts', cp.signal_counts,
    'total_signals', cp.total_signals,
    'trend_direction', cp.trend_direction,
    'latest_brief_id', cp.latest_brief_id,
    'last_activity_at', cp.last_activity_at
  ) || COALESCE(cp.metadata::jsonb, '{}'::jsonb),
  jsonb_build_array(jsonb_build_object('type', 'migration', 'tag', '008_unify_proposal_surface')),
  'applied',
  cp.created_at
FROM competitor_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM graph_nodes gn
   WHERE gn.project_id = cp.project_id
     AND gn.node_type = 'competitor'
     AND gn.name = cp.name
);

COMMIT;

-- ─── 4. assumptions → memory_facts(kind='assumption') ───────────────────────
-- Only runs if the assumptions table exists (it isn't yet migrated to the
-- shared Supabase as of this writing — see plan §"things to verify").
-- The DO block lets the migration succeed even when the source table is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'assumptions') THEN
    INSERT INTO memory_facts
      (id, user_id, project_id, fact, kind, source_type, source_id, reviewed_state, sources, confidence, created_at)
    SELECT
      'mf_as_' || substr(md5(a.id), 1, 12),
      p.owner_user_id,
      a.project_id,
      a.text,
      'assumption',
      'assumption_migration',
      a.id,
      CASE a.status
        WHEN 'validated'    THEN 'applied'
        WHEN 'invalidated'  THEN 'rejected'
        WHEN 'accepted_risk' THEN 'applied'
        ELSE 'pending'
      END,
      jsonb_build_array(jsonb_build_object(
        'type', 'migration',
        'tag', '008_unify_proposal_surface',
        'origin_id', a.id,
        'criticality', a.criticality,
        'category', a.category
      )),
      CASE WHEN a.explicit THEN 0.9 ELSE 0.5 END,
      a.created_at
    FROM assumptions a
    JOIN projects p ON p.id = a.project_id
    WHERE NOT EXISTS (
      SELECT 1 FROM memory_facts mf
       WHERE mf.kind = 'assumption' AND mf.source_id = a.id
    );
  END IF;
END $$;

-- ─── 5. DROP truly-dead tables (0 rows globally, 0 active writers) ──────────
-- Verified via grep + COUNT(*) on 2026-06-03. If your team has added writers
-- since, re-verify before applying.
--
-- Commented out by default — uncomment per table after you've grepped for any
-- recent references in code that may have been added between plan & apply.
--
-- DROP TABLE IF EXISTS simulation         CASCADE;
-- DROP TABLE IF EXISTS workflow           CASCADE;
-- DROP TABLE IF EXISTS metrics            CASCADE;
-- DROP TABLE IF EXISTS metric_entries     CASCADE;
-- DROP TABLE IF EXISTS burn_rate          CASCADE;
-- DROP TABLE IF EXISTS pricing_state      CASCADE;
-- DROP TABLE IF EXISTS growth_loops       CASCADE;
-- DROP TABLE IF EXISTS growth_iterations  CASCADE;
-- DROP TABLE IF EXISTS investors          CASCADE;
-- DROP TABLE IF EXISTS investor_interactions CASCADE;
-- DROP TABLE IF EXISTS fundraising_rounds CASCADE;
-- DROP TABLE IF EXISTS pitch_versions     CASCADE;
-- DROP TABLE IF EXISTS term_sheets        CASCADE;
-- DROP TABLE IF EXISTS milestones         CASCADE;
-- DROP TABLE IF EXISTS startup_updates    CASCADE;
-- DROP TABLE IF EXISTS tools              CASCADE;
-- DROP TABLE IF EXISTS drafts             CASCADE;
-- DROP TABLE IF EXISTS draft_versions     CASCADE;
-- DROP TABLE IF EXISTS tool_executions    CASCADE;
-- DROP TABLE IF EXISTS published_assets   CASCADE;
-- DROP TABLE IF EXISTS partner_configs    CASCADE;
-- DROP TABLE IF EXISTS build_artifacts    CASCADE;
-- DROP TABLE IF EXISTS tabular_cells      CASCADE;
-- DROP TABLE IF EXISTS tabular_reviews    CASCADE;

-- ─── 6. After producer cutover, DROP the migrated side tables ───────────────
-- Phase 4 (separate migration 009_drop_proposal_side_tables.sql) will:
--   DROP TABLE ecosystem_alerts;
--   DROP TABLE intelligence_briefs;
--   DROP TABLE source_changes;
--   DROP TABLE signal_activity_logs;
--   DROP TABLE competitor_profiles;
--   DROP TABLE assumptions;   -- once memory_facts(kind='assumption') is canonical
-- Do NOT include those here — keep the migrated rows readable for a release
-- cycle in case a rollback is needed.

-- End of 008.
