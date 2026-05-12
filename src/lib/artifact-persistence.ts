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
import { generateId } from '@/lib/api-helpers';
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
  TaskArtifact,
  HtmlPreviewArtifact,
  DocumentArtifact,
  Source,
} from '@/types/artifacts';
import { recordFact } from './memory/facts';
import { createPendingAction } from './pending-actions';
import { getCreditsRemaining } from './credits';
import type { PendingActionType } from '@/types';

/**
 * Serialize a sources array to JSON for persistence, or null when empty.
 * Parser-level validation guarantees sources[] is non-empty for factual
 * artifacts by the time they reach here; this helper is defensive for the
 * small number of call sites where sources are optional (synthesis types).
 */
function sourcesJson(sources: Source[] | undefined): string | null {
  return Array.isArray(sources) && sources.length > 0 ? JSON.stringify(sources) : null;
}

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
  /** Server-assigned ID for the persisted row (graph_node id, fact id, etc.) */
  persisted_id?: string;
}

export async function persistArtifact(ctx: PersistContext, artifact: Artifact): Promise<PersistResult> {
  try {
    switch (artifact.type) {
      case 'entity-card':
        return await persistEntityCard(ctx, artifact as EntityCard);
      case 'insight-card':
        return await persistInsightCard(ctx, artifact as InsightCard);
      case 'gauge-chart':
        return await persistGaugeChart(ctx, artifact as GaugeChartArtifact);
      case 'radar-chart':
        return await persistRadarChart(ctx, artifact as RadarChartArtifact);
      case 'score-card':
        return await persistScoreCard(ctx, artifact as ScoreCardArtifact);
      case 'metric-grid':
        return await persistMetricGrid(ctx, artifact as MetricGrid);
      case 'comparison-table':
        return await persistComparisonTable(ctx, artifact as ComparisonTable);
      case 'action-suggestion':
        return await persistActionSuggestion(ctx, artifact as ActionSuggestion);
      case 'task':
        return await persistTask(ctx, artifact as TaskArtifact);
      case 'html-preview':
        return await persistBuildArtifact(ctx, artifact as HtmlPreviewArtifact);
      case 'document':
        return await persistDocumentArtifact(ctx, artifact as DocumentArtifact);
      case 'solve-progress':
        return { type: artifact.type, persisted: false, note: 'UI-only tracker' };
      default:
        return { type: artifact.type, persisted: false, note: 'no handler' };
    }
  } catch (err) {
    console.warn(`[artifact-persistence] ${artifact.type} failed:`, (err as Error).message);
    return { type: artifact.type, persisted: false, note: (err as Error).message };
  }
}

// ─── entity-card → graph_nodes + graph_edges ─────────────────────────────────

async function persistEntityCard(ctx: PersistContext, a: EntityCard): Promise<PersistResult> {
  if (!a.name) return { type: a.type, persisted: false, note: 'missing name' };

  // Dedup by (project_id, lower(name)) — agent may mention same entity across turns.
  const existing = await get<{ id: string }>(
    'SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    ctx.projectId,
    a.name,
  );

  const srcJson = sourcesJson(a.sources);

  if (existing) {
    // COALESCE keeps prior sources when the update carries none — the parser
    // guarantees factual artifacts arrive with sources, so this is mostly
    // a safety net against future relaxation of the rule.
    // NOTE: UPDATE preserves existing reviewed_state — don't reset to pending.
    await run(
      'UPDATE graph_nodes SET summary = ?, attributes = ?, sources = COALESCE(?, sources) WHERE id = ?',
      a.summary ?? '',
      JSON.stringify(a.attributes ?? {}),
      srcJson,
      existing.id,
    );
    return { type: a.type, persisted: true, target: 'graph_nodes (update)', persisted_id: existing.id };
  }

  const id = `node_${crypto.randomUUID().slice(0, 12)}`;
  await run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    id,
    ctx.projectId,
    a.name,
    a.entity_type ?? 'entity',
    a.summary ?? '',
    JSON.stringify(a.attributes ?? {}),
    srcJson,
  );

  // Edge from project root (if it exists) to this new node. Relation name
  // is derived from entity_type for a little semantic colour on the graph.
  // Edge inherits the entity-card's sources — same provenance justifies
  // both the node's existence and the relationship claim.
  const root = await get<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",
    ctx.projectId,
  );
  if (root) {
    const relation = relationForEntityType(a.entity_type);
    await run(
      `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, sources)
       VALUES (?, ?, ?, ?, ?, ?)`,
      `edge_${crypto.randomUUID().slice(0, 12)}`,
      ctx.projectId,
      root.id,
      id,
      relation,
      srcJson,
    );
  }

  return { type: a.type, persisted: true, target: 'graph_nodes (insert)', persisted_id: id };
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

async function persistInsightCard(ctx: PersistContext, a: InsightCard): Promise<PersistResult> {
  const title = (a.title ?? '').trim();
  const body = (a.body ?? '').trim();
  if (!title && !body) return { type: a.type, persisted: false, note: 'empty insight' };

  const fact = (title && body ? `${title}: ${body}` : title || body).slice(0, 600);
  const confidence =
    a.confidence === 'high' ? 0.9 :
    a.confidence === 'medium' ? 0.7 :
    a.confidence === 'low' ? 0.5 :
    0.75;

  const factId = await recordFact({
    userId: ctx.userId,
    projectId: ctx.projectId,
    fact,
    kind: 'observation',
    sourceType: 'chat',
    confidence,
    // Thread through the insight-card's sources so the memory fact carries
    // the same verifiable provenance as the original artifact. Future
    // `buildMemoryContext` calls can surface the URL/quote alongside the
    // fact text.
    sources: a.sources,
  });

  return { type: a.type, persisted: true, target: 'memory_facts (observation)', persisted_id: factId || undefined };
}

// ─── gauge-chart → scores.overall_score + benchmark ──────────────────────────

async function persistGaugeChart(ctx: PersistContext, a: GaugeChartArtifact): Promise<PersistResult> {
  if (typeof a.score !== 'number') return { type: a.type, persisted: false, note: 'non-numeric score' };

  const normalizedScore = a.maxScore && a.maxScore > 0 ? (a.score * 10) / a.maxScore : a.score;
  const benchmark = a.verdict ?? null;
  const srcJson = sourcesJson(a.sources);

  const existing = await get<{ project_id: string }>(
    'SELECT project_id FROM scores WHERE project_id = ?',
    ctx.projectId,
  );

  if (existing) {
    await run(
      'UPDATE scores SET overall_score = ?, benchmark = COALESCE(?, benchmark), sources = COALESCE(?, sources), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      normalizedScore,
      benchmark,
      srcJson,
      ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO scores (project_id, overall_score, benchmark, dimensions, sources) VALUES (?, ?, ?, ?, ?)',
      ctx.projectId,
      normalizedScore,
      benchmark,
      '{}',
      srcJson,
    );
  }

  return { type: a.type, persisted: true, target: 'scores (overall_score)' };
}

// ─── radar-chart → scores.dimensions (merged JSON) ───────────────────────────

async function persistRadarChart(ctx: PersistContext, a: RadarChartArtifact): Promise<PersistResult> {
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

  const existing = await get<{ dimensions: Record<string, unknown> | null }>(
    'SELECT dimensions FROM scores WHERE project_id = ?',
    ctx.projectId,
  );

  const srcJson = sourcesJson(a.sources);

  if (existing) {
    const prior = (existing.dimensions as Record<string, unknown> | null) || {};
    const merged = { ...prior, ...incoming };
    await run(
      'UPDATE scores SET dimensions = ?, sources = COALESCE(?, sources), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify(merged),
      srcJson,
      ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO scores (project_id, overall_score, dimensions, sources) VALUES (?, 0, ?, ?)',
      ctx.projectId,
      JSON.stringify(incoming),
      srcJson,
    );
  }

  return { type: a.type, persisted: true, target: `scores.dimensions (+${Object.keys(incoming).length} dims)` };
}

// ─── score-card → scores.dimensions (single key) ─────────────────────────────

async function persistScoreCard(ctx: PersistContext, a: ScoreCardArtifact): Promise<PersistResult> {
  if (typeof a.score !== 'number' || !a.title) {
    return { type: a.type, persisted: false, note: 'missing title or score' };
  }

  const existing = await get<{ dimensions: Record<string, unknown> | null }>(
    'SELECT dimensions FROM scores WHERE project_id = ?',
    ctx.projectId,
  );
  const prior = existing ? ((existing.dimensions as Record<string, unknown> | null) || {}) : {};
  const merged = { ...prior, [a.title]: a.score };
  const srcJson = sourcesJson(a.sources);

  if (existing) {
    await run(
      'UPDATE scores SET dimensions = ?, sources = COALESCE(?, sources), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify(merged),
      srcJson,
      ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO scores (project_id, overall_score, dimensions, sources) VALUES (?, 0, ?, ?)',
      ctx.projectId,
      JSON.stringify(merged),
      srcJson,
    );
  }

  return { type: a.type, persisted: true, target: `scores.dimensions["${a.title}"]` };
}

// ─── metric-grid → research.market_size (when market-themed) ─────────────────

async function persistMetricGrid(ctx: PersistContext, a: MetricGrid): Promise<PersistResult> {
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

  const existing = await get<{ project_id: string }>(
    'SELECT project_id FROM research WHERE project_id = ?',
    ctx.projectId,
  );

  const srcJson = sourcesJson(a.sources);

  if (existing) {
    await run(
      'UPDATE research SET market_size = ?, sources = COALESCE(?, sources), researched_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify({ ...marketData, _title: a.title }),
      srcJson,
      ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO research (project_id, market_size, sources) VALUES (?, ?, ?)',
      ctx.projectId,
      JSON.stringify({ ...marketData, _title: a.title }),
      srcJson,
    );
  }

  return { type: a.type, persisted: true, target: 'research.market_size' };
}

// ─── comparison-table → research.competitors (when competitor-themed) ────────

async function persistComparisonTable(ctx: PersistContext, a: ComparisonTable): Promise<PersistResult> {
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

  const existing = await get<{ project_id: string }>(
    'SELECT project_id FROM research WHERE project_id = ?',
    ctx.projectId,
  );
  const srcJson = sourcesJson(a.sources);

  if (existing) {
    await run(
      'UPDATE research SET competitors = ?, sources = COALESCE(?, sources), researched_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      JSON.stringify(competitors),
      srcJson,
      ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO research (project_id, competitors, sources) VALUES (?, ?, ?)',
      ctx.projectId,
      JSON.stringify(competitors),
      srcJson,
    );
  }

  return { type: a.type, persisted: true, target: `research.competitors (${competitors.length})` };
}

// ─── action-suggestion → pending_actions ─────────────────────────────────────

async function persistActionSuggestion(ctx: PersistContext, a: ActionSuggestion): Promise<PersistResult> {
  const title = (a.title ?? '').trim();
  if (!title) return { type: a.type, persisted: false, note: 'missing title' };

  const actionType = mapActionType(a.action_type);

  await createPendingAction({
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
    // Propagate sources through to pending_actions.sources so the inbox UI
    // can render why the agent proposed this action.
    sources: a.sources,
  });

  return { type: a.type, persisted: true, target: `pending_actions (${actionType})` };
}

// ─── task → pending_actions (action_type='task') ─────────────────────────────

/**
 * `task` artifact → pending_actions row.
 *
 * Dedup: (project_id, action_type='task', payload.client_artifact_id = a.id)
 * — re-runs of the same chat turn (e.g. browser refresh during stream) won't
 * create duplicate task rows.
 *
 * The TaskCard PATCH endpoint at /api/projects/[projectId]/tasks/[clientArtifactId]
 * looks up by the same client_artifact_id, so the inline card stays addressable
 * even when the artifact JSON didn't carry a server-assigned pending_action_id
 * (which is the case for raw :::artifact{type:"task"} emission, as opposed to
 * the create_task tool path that writes the row up-front and embeds the id).
 */
async function persistTask(ctx: PersistContext, a: TaskArtifact): Promise<PersistResult> {
  const title = (a.title ?? '').trim();
  if (!title) return { type: a.type, persisted: false, note: 'missing title' };

  const clientArtifactId = a.id || null;

  // Credit guard — refuse to write a task row when the project is out of
  // credits this month. Same check guards the create_task tool path; the
  // monthly cap (project_budgets.cap_llm_usd) is the real ceiling.
  if (await getCreditsRemaining(ctx.projectId) <= 0) {
    return { type: a.type, persisted: false, note: 'out of credits' };
  }

  // Dedupe by client_artifact_id when the artifact carries one — protects
  // against the chat route re-running persistence on stream replay.
  if (clientArtifactId) {
    const existing = await get<{ id: string }>(
      `SELECT id FROM pending_actions
       WHERE project_id = ? AND action_type = 'task'
         AND payload->>'client_artifact_id' = ?
       LIMIT 1`,
      ctx.projectId,
      clientArtifactId,
    );
    if (existing) {
      return { type: a.type, persisted: false, note: 'duplicate (client_artifact_id match)' };
    }
  }

  await createPendingAction({
    project_id: ctx.projectId,
    action_type: 'task',
    title: title.slice(0, 200),
    rationale: (a.description ?? '').slice(0, 800),
    payload: {
      source: 'task-artifact',
      client_artifact_id: clientArtifactId,
      due: a.due ?? null,
    },
    estimated_impact: 'medium',
    sources: a.sources,
    priority: a.priority,
  });

  return { type: a.type, persisted: true, target: `pending_actions (task, ${a.priority})` };
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

// ─── html-preview → build_artifacts ──────────────────────────────────────────

async function persistBuildArtifact(ctx: PersistContext, a: HtmlPreviewArtifact): Promise<PersistResult> {
  if (!a.html) return { type: a.type, persisted: false, note: 'empty html' };

  const id = generateId('ba');
  await run(
    `INSERT INTO build_artifacts (id, project_id, skill_id, artifact_type, title, content, metadata, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    ctx.projectId,
    'build-landing-page',
    'html-preview',
    a.title || 'Landing Page',
    a.html,
    JSON.stringify({ viewport: a.viewport ?? 'desktop' }),
    JSON.stringify(a.sources ?? []),
    new Date().toISOString(),
  );

  return { type: a.type, persisted: true, target: `build_artifacts (${id})` };
}

// ─── document → build_artifacts ──────────────────────────────────────────────

async function persistDocumentArtifact(ctx: PersistContext, a: DocumentArtifact): Promise<PersistResult> {
  if (!a.content) return { type: a.type, persisted: false, note: 'empty content' };

  const skillId = a.doc_type === 'pitch-deck' ? 'build-pitch-deck'
    : a.doc_type === 'one-pager' ? 'build-one-pager'
    : 'build-document';
  const id = generateId('ba');
  await run(
    `INSERT INTO build_artifacts (id, project_id, skill_id, artifact_type, title, content, doc_type, metadata, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    ctx.projectId,
    skillId,
    'document',
    a.title || 'Document',
    a.content,
    a.doc_type,
    JSON.stringify({ sections_count: a.sections?.length ?? 0 }),
    JSON.stringify(a.sources ?? []),
    new Date().toISOString(),
  );

  return { type: a.type, persisted: true, target: `build_artifacts (${id}, ${a.doc_type})` };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// safeJson is no longer needed — dimensions is JSONB and postgres.js returns
// it as an already-parsed object. Removed.
