/**
 * Artifact → persistent-table dispatcher.
 *
 * When the agent emits :::artifact{type=X} blocks in a chat response, the
 * canvas renders them immediately — but without this module, they vanish
 * on refresh because nothing writes them to the underlying data tables.
 *
 * Each artifact type maps to a natural home:
 *
 *   entity-card       → graph_nodes (+ edge from project root)
 *   insight-card      → memory_facts (kind='observation')
 *   gauge-chart       → scores.overall_score + benchmark
 *   radar-chart       → scores.dimensions (merged JSON)
 *   score-card        → scores.dimensions (single key)
 *   metric-grid       → research.market_size (if market-themed)
 *   comparison-table  → research.competitors (if competitor-themed)
 *   action-suggestion → pending_actions
 *   fact              → memory_facts (handled by chat route directly)
 *   workflow-card     → workflow_plans + pending_actions (handled by captureWorkflow)
 *   option-set        → UI-only; Tier 2 wires these to click-to-invoke
 *
 * All handlers are non-fatal: persistence failures never break the chat
 * stream. They're wrapped in a single try/catch at the dispatch layer.
 */

import crypto from 'crypto';
import { get, run } from '@/lib/db';
import type {
  Artifact,
  EntityCard,
  InsightCard,
  GaugeChartArtifact,
  RadarChartArtifact,
  ScoreCardArtifact,
  MetricGrid,
  ComparisonTable,
  ActionSuggestion,
} from '@/types/artifacts';
import { recordFact } from './memory/facts';
import { createPendingAction } from './pending-actions';
import type { PendingActionType } from '@/types';

export interface PersistContext {
  userId: string;
  projectId: string;
}

/** Summary of what persistArtifact did, returned for optional logging. */
export interface PersistResult {
  type: string;
  persisted: boolean;
  target?: string;
  note?: string;
}

export function persistArtifact(ctx: PersistContext, artifact: Artifact): PersistResult {
  try {
    switch (artifact.type) {
      case 'entity-card':
        return persistEntityCard(ctx, artifact as EntityCard);
      case 'insight-card':
        return persistInsightCard(ctx, artifact as InsightCard);
      case 'gauge-chart':
        return persistGaugeChart(ctx, artifact as GaugeChartArtifact);
      case 'radar-chart':
        return persistRadarChart(ctx, artifact as RadarChartArtifact);
      case 'score-card':
        return persistScoreCard(ctx, artifact as ScoreCardArtifact);
      case 'metric-grid':
        return persistMetricGrid(ctx, artifact as MetricGrid);
      case 'comparison-table':
        return persistComparisonTable(ctx, artifact as ComparisonTable);
      case 'action-suggestion':
        return persistActionSuggestion(ctx, artifact as ActionSuggestion);
      default:
        return { type: artifact.type, persisted: false, note: 'no handler' };
    }
  } catch (err) {
    console.warn(`[artifact-persistence] ${artifact.type} failed:`, (err as Error).message);
    return { type: artifact.type, persisted: false, note: (err as Error).message };
  }
}

// ─── entity-card → graph_nodes + graph_edges ─────────────────────────────────

function persistEntityCard(ctx: PersistContext, a: EntityCard): PersistResult {
  if (!a.name) return { type: a.type, persisted: false, note: 'missing name' };

  // Dedup by (project_id, lower(name)) — agent may mention same entity across turns.
  const existing = get<{ id: string }>(
    'SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    ctx.projectId,
    a.name,
  );

  if (existing) {
    run(
      'UPDATE graph_nodes SET summary = ?, attributes = ? WHERE id = ?',
      a.summary ?? '',
      JSON.stringify(a.attributes ?? {}),
      existing.id,
    );
    return { type: a.type, persisted: true, target: 'graph_nodes (update)' };
  }

  const id = `node_${crypto.randomUUID().slice(0, 12)}`;
  run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    ctx.projectId,
    a.name,
    a.entity_type ?? 'entity',
    a.summary ?? '',
    JSON.stringify(a.attributes ?? {}),
  );

  // Edge from project root (if it exists) to this new node. Relation name
  // is derived from entity_type for a little semantic colour on the graph.
  const root = get<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",
    ctx.projectId,
  );
  if (root) {
    const relation = relationForEntityType(a.entity_type);
    run(
      `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation)
       VALUES (?, ?, ?, ?, ?)`,
      `edge_${crypto.randomUUID().slice(0, 12)}`,
      ctx.projectId,
      root.id,
      id,
      relation,
    );
  }

  return { type: a.type, persisted: true, target: 'graph_nodes (insert)' };
}

function relationForEntityType(t: string | undefined): string {
  switch (t) {
    case 'competitor': return 'competes_with';
    case 'customer':   return 'serves';
    case 'market':     return 'operates_in';
    case 'investor':   return 'funded_by';
    case 'technology': return 'uses';
    case 'partner':    return 'partners_with';
    default:           return 'related_to';
  }
}

// ─── insight-card → memory_facts ─────────────────────────────────────────────

function persistInsightCard(ctx: PersistContext, a: InsightCard): PersistResult {
  const title = (a.title ?? '').trim();
  const body = (a.body ?? '').trim();
  if (!title && !body) return { type: a.type, persisted: false, note: 'empty insight' };

  const fact = (title && body ? `${title}: ${body}` : title || body).slice(0, 600);
  const confidence =
    a.confidence === 'high' ? 0.9 :
    a.confidence === 'medium' ? 0.7 :
    a.confidence === 'low' ? 0.5 :
    0.75;

  recordFact({
    userId: ctx.userId,
    projectId: ctx.projectId,
    fact,
    kind: 'observation',
    sourceType: 'chat',
    confidence,
  });

  return { type: a.type, persisted: true, target: 'memory_facts (observation)' };
}

// ─── gauge-chart → scores.overall_score + benchmark ──────────────────────────

function persistGaugeChart(ctx: PersistContext, a: GaugeChartArtifact): PersistResult {
  if (typeof a.score !== 'number') return { type: a.type, persisted: false, note: 'non-numeric score' };

  const normalizedScore = a.maxScore && a.maxScore > 0 ? (a.score * 10) / a.maxScore : a.score;
  const benchmark = a.verdict ?? null;

  const existing = get<{ project_id: string }>(
    'SELECT project_id FROM scores WHERE project_id = ?',
    ctx.projectId,
  );

  if (existing) {
    run(
      'UPDATE scores SET overall_score = ?, benchmark = COALESCE(?, benchmark), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      normalizedScore,
      benchmark,
      ctx.projectId,
    );
  } else {
    run(
      'INSERT INTO scores (project_id, overall_score, benchmark, dimensions) VALUES (?, ?, ?, ?)',
      ctx.projectId,
      normalizedScore,
      benchmark,
      '{}',
    );
  }

  return { type: a.type, persisted: true, target: 'scores (overall_score)' };
}

// ─── radar-chart → scores.dimensions (merged JSON) ───────────────────────────

function persistRadarChart(ctx: PersistContext, a: RadarChartArtifact): PersistResult {
  if (!Array.isArray(a.data) || a.data.length === 0) {
    return { type: a.type, persisted: false, note: 'no data points' };
  }

  const incoming: Record<string, number> = {};
  for (const point of a.data) {
    if (point && typeof point.subject === 'string' && typeof point.value === 'number') {
      incoming[point.subject] = point.value;
    }
  }
  if (Object.keys(incoming).length === 0) {
    return { type: a.type, persisted: false, note: 'no usable points' };
  }

  const existing = get<{ dimensions: string | null }>(
    'SELECT dimensions FROM scores WHERE project_id = ?',
    ctx.projectId,
  );

  if (existing) {
    const prior = safeJson(existing.dimensions) || {};
    const merged = { ...prior, ...incoming };
    run(
      'UPDATE scores SET dimensions = ?, scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify(merged),
      ctx.projectId,
    );
  } else {
    run(
      'INSERT INTO scores (project_id, overall_score, dimensions) VALUES (?, 0, ?)',
      ctx.projectId,
      JSON.stringify(incoming),
    );
  }

  return { type: a.type, persisted: true, target: `scores.dimensions (+${Object.keys(incoming).length} dims)` };
}

// ─── score-card → scores.dimensions (single key) ─────────────────────────────

function persistScoreCard(ctx: PersistContext, a: ScoreCardArtifact): PersistResult {
  if (typeof a.score !== 'number' || !a.title) {
    return { type: a.type, persisted: false, note: 'missing title or score' };
  }

  const existing = get<{ dimensions: string | null }>(
    'SELECT dimensions FROM scores WHERE project_id = ?',
    ctx.projectId,
  );
  const prior = existing ? (safeJson(existing.dimensions) || {}) : {};
  const merged = { ...prior, [a.title]: a.score };

  if (existing) {
    run(
      'UPDATE scores SET dimensions = ?, scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify(merged),
      ctx.projectId,
    );
  } else {
    run(
      'INSERT INTO scores (project_id, overall_score, dimensions) VALUES (?, 0, ?)',
      ctx.projectId,
      JSON.stringify(merged),
    );
  }

  return { type: a.type, persisted: true, target: `scores.dimensions["${a.title}"]` };
}

// ─── metric-grid → research.market_size (when market-themed) ─────────────────

function persistMetricGrid(ctx: PersistContext, a: MetricGrid): PersistResult {
  if (!Array.isArray(a.metrics) || a.metrics.length === 0) {
    return { type: a.type, persisted: false, note: 'no metrics' };
  }

  const titleText = `${a.title ?? ''}`.toLowerCase();
  const isMarket = /market|tam|sam|som|demand|size|fractional|executive/.test(titleText);

  if (!isMarket) {
    return { type: a.type, persisted: false, note: 'not market-themed, skipping' };
  }

  const marketData = a.metrics.reduce<Record<string, { value: string; change?: string }>>((acc, m) => {
    if (m && typeof m.label === 'string' && typeof m.value === 'string') {
      acc[m.label] = { value: m.value, ...(m.change ? { change: m.change } : {}) };
    }
    return acc;
  }, {});

  const existing = get<{ project_id: string }>(
    'SELECT project_id FROM research WHERE project_id = ?',
    ctx.projectId,
  );

  if (existing) {
    run(
      'UPDATE research SET market_size = ?, researched_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify({ ...marketData, _title: a.title }),
      ctx.projectId,
    );
  } else {
    run(
      'INSERT INTO research (project_id, market_size) VALUES (?, ?)',
      ctx.projectId,
      JSON.stringify({ ...marketData, _title: a.title }),
    );
  }

  return { type: a.type, persisted: true, target: 'research.market_size' };
}

// ─── comparison-table → research.competitors (when competitor-themed) ────────

function persistComparisonTable(ctx: PersistContext, a: ComparisonTable): PersistResult {
  if (!Array.isArray(a.rows) || !Array.isArray(a.columns)) {
    return { type: a.type, persisted: false, note: 'malformed table' };
  }

  const titleText = `${a.title ?? ''}`.toLowerCase();
  const isCompetitive = /competitor|vs\.?|compare|platform|alternatives/.test(titleText);

  if (!isCompetitive) {
    return { type: a.type, persisted: false, note: 'not competitor-themed, skipping' };
  }

  const competitors = a.rows.map((r) => ({
    name: r.label,
    attributes: a.columns.reduce<Record<string, unknown>>((acc, col, i) => {
      acc[col] = r.values?.[i];
      return acc;
    }, {}),
  }));

  const existing = get<{ project_id: string }>(
    'SELECT project_id FROM research WHERE project_id = ?',
    ctx.projectId,
  );

  if (existing) {
    run(
      'UPDATE research SET competitors = ?, researched_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify(competitors),
      ctx.projectId,
    );
  } else {
    run(
      'INSERT INTO research (project_id, competitors) VALUES (?, ?)',
      ctx.projectId,
      JSON.stringify(competitors),
    );
  }

  return { type: a.type, persisted: true, target: `research.competitors (${competitors.length})` };
}

// ─── action-suggestion → pending_actions ─────────────────────────────────────

function persistActionSuggestion(ctx: PersistContext, a: ActionSuggestion): PersistResult {
  const title = (a.title ?? '').trim();
  if (!title) return { type: a.type, persisted: false, note: 'missing title' };

  const actionType = mapActionType(a.action_type);

  createPendingAction({
    project_id: ctx.projectId,
    action_type: actionType,
    title: title.slice(0, 120),
    rationale: (a.description ?? '').slice(0, 500),
    payload: {
      source: 'action-suggestion',
      action_label: a.action_label,
      action_type_raw: a.action_type,
    },
    estimated_impact: 'medium',
  });

  return { type: a.type, persisted: true, target: `pending_actions (${actionType})` };
}

function mapActionType(raw: string | undefined): PendingActionType {
  const r = (raw ?? '').toLowerCase();
  if (r.includes('email')) return 'draft_email';
  if (r.includes('linkedin') && r.includes('dm')) return 'draft_linkedin_dm';
  if (r.includes('linkedin')) return 'draft_linkedin_post';
  if (r.includes('graph')) return 'proposed_graph_update';
  if (r.includes('interview')) return 'proposed_interview_question';
  if (r.includes('landing') || r.includes('copy')) return 'proposed_landing_copy';
  if (r.includes('investor')) return 'proposed_investor_followup';
  if (r.includes('workflow') || r.includes('step')) return 'workflow_step';
  return 'proposed_hypothesis';
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function safeJson(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
