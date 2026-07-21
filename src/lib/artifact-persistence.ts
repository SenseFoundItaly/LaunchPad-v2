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
 *                       + per-row PENDING competitor graph_nodes
 *   investor-pipeline → per-investor PENDING funding_source graph_nodes
 *   action-suggestion → pending_actions
 *   fact              → memory_facts (handled by chat route directly)
 *   workflow-card     → workflow_plans (handled by captureWorkflow; no Inbox fan-out)
 *   option-set        → UI-only; Tier 2 wires these to click-to-invoke
 *
 * All handlers are non-fatal: persistence failures never break the chat
 * stream. They're wrapped in a single try/catch at the dispatch layer.
 */

import crypto from 'crypto';
import { get, run } from '@/lib/db';
import { coerceJson } from '@/lib/jsonb';
import { parseScoreSummary } from '@/lib/score-summary';
import { generateId } from '@/lib/api-helpers';
import { recordScoreHistory } from '@/lib/score-history';
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
  TamSamSomArtifact,
  IdeaCanvasArtifact,
  InvestorPipelineArtifact,
  PersonaCard,
  RiskMatrixArtifact,
  WeeklyUpdateArtifact,
  Source,
} from '@/types/artifacts';
import { marketSizeFromTamSamSom } from './research-context';
import { persistCanvasDetails } from './canvas-details';
import { recordFact } from './memory/facts';
import { createPendingAction } from './pending-actions';
import { getCreditsRemaining } from './credits';
import { autoStageValidationFromArtifact } from './auto-stage-validation';
import { persistCompetitorCategories } from './competitor-categories';
import type { PendingActionType } from '@/types';

/**
 * Serialize a sources array to JSON for persistence, or null when empty.
 * Parser-level validation guarantees sources[] is non-empty for factual
 * artifacts by the time they reach here; this helper is defensive for the
 * small number of call sites where sources are optional (synthesis types).
 */
// JSONB bind: return the RAW array (postgres.js single-encodes it). JSON.stringify
// here stored a double-encoded string scalar → Array.isArray readers silently empty.
function sourcesJson(sources: Source[] | undefined): Source[] | null {
  return Array.isArray(sources) && sources.length > 0 ? sources : null;
}

/**
 * Upsert a metric-grid / comparison-table style artifact into graph_nodes so it
 * appears in Context > Intelligence regardless of whether it matched a themed
 * routing path (e.g. research.market_size). Dedupes on (project_id, lower(name))
 * exactly like persistEntityCard. Non-fatal — returns undefined on failure.
 */
async function upsertGraphNodeFromArtifact(
  ctx: PersistContext,
  input: {
    name: string;
    nodeType: string;
    summary: string;
    attributes: Record<string, unknown>;
    srcJson: Source[] | null;
    /** Review state for NEW nodes only — the UPDATE path always preserves the
     *  existing reviewed_state. Defaults to 'pending': chat-surfaced
     *  intelligence is a PROPOSAL the founder applies (0.5 credits) before it
     *  enters project knowledge. Callers with their own evidence (web-sourced
     *  competitor rows the founder watched get researched) pass 'applied'. */
    reviewedState?: 'pending' | 'applied';
  },
): Promise<string | undefined> {
  if (!input.name) return undefined;
  try {
    const existing = await get<{ id: string }>(
      'SELECT id FROM graph_nodes WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
      ctx.projectId,
      input.name,
    );
    if (existing) {
      await run(
        'UPDATE graph_nodes SET summary = ?, attributes = ?, sources = COALESCE(?, sources) WHERE id = ?',
        input.summary,
        // Pass the OBJECT, not JSON.stringify(...). attributes is a JSONB column;
      // postgres.js serializes an object correctly, whereas stringifying stores a
      // double-encoded JSON *string* scalar that reads back as a string (which
      // Object.entries then renders character-by-character). See pending-actions.ts:505.
      input.attributes,
        input.srcJson,
        existing.id,
      );
      return existing.id;
    }
    const id = `node_${crypto.randomUUID().slice(0, 12)}`;
    await run(
      `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.projectId,
      input.name,
      input.nodeType,
      input.summary,
      // Pass the OBJECT, not JSON.stringify(...). attributes is a JSONB column;
      // postgres.js serializes an object correctly, whereas stringifying stores a
      // double-encoded JSON *string* scalar that reads back as a string (which
      // Object.entries then renders character-by-character). See pending-actions.ts:505.
      input.attributes,
      input.srcJson,
      input.reviewedState ?? 'pending',
    );
    return id;
  } catch (err) {
    console.warn('[artifact-persistence] graph_node upsert failed (non-fatal):', err);
    return undefined;
  }
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
      // idea-canvas + tam-sam-som map to gated spine checks. The agent reliably
      // EMITS them but rarely calls propose_validation (founder-sim 2026-06-14),
      // so capture them deterministically: auto-stage a validation_proposal
      // (deduped, pending) the founder can approve onto the spine — no reliance
      // on the model calling the tool. Gate-respecting: nothing greens without
      // approval. (Competitors are captured separately by persistComparisonTable.)
      case 'idea-canvas': {
        // SOFT fields (unfair_advantage + key_metrics/revenue_streams/cost_structure)
        // carry no stage gate, so persist them directly (ungated) — otherwise the
        // agent emits a full Lean Canvas that renders once and is dropped.
        await persistCanvasDetails(ctx.projectId, artifact as IdeaCanvasArtifact).catch(() => {});
        // CORE 6 fields gate Stage 1-3 → validation_proposal the founder approves.
        const r = await autoStageValidationFromArtifact(ctx.projectId, artifact);
        return r.staged
          ? { type: artifact.type, persisted: true, target: `validation_proposal (auto, ${r.itemCount} item(s)) + canvas details`, persisted_id: r.pendingActionId }
          : { type: artifact.type, persisted: false, note: 'canvas details persisted; gate view-only / already staged' };
      }
      case 'tam-sam-som': {
        // TWO writes, distinct purposes:
        //  (1) REFERENCE (ungated): the committed TAM/SAM/SOM → research.market_size,
        //      the column buildResearchContext re-reads so the agent reuses ONE figure
        //      across turns. Without this the chat-stated sizing never persists and the
        //      next turn denies/re-derives it (verified live 2026-06-25). Bind the RAW
        //      object (postgres.js single-encodes JSONB); coerceJson reads it back.
        //  (2) EVIDENCE (gated): the validation_proposal the founder approves onto the
        //      spine — unchanged. Reference data does not green any stage check.
        const sizing = marketSizeFromTamSamSom(artifact as TamSamSomArtifact);
        let sizingTarget = '';
        if (sizing) {
          const srcJson = sourcesJson((artifact as TamSamSomArtifact).sources);
          const existing = await get<{ project_id: string }>(
            'SELECT project_id FROM research WHERE project_id = ?',
            ctx.projectId,
          );
          if (existing) {
            // Full-replace, but CARRY the founder's approval stamp
            // (approved/approved_at/approved_value) across — this ungated
            // reference write must never wipe the founder-clicked evidence
            // (approval durability, audit B3). approved_value keeps the
            // approved tiers even when the incoming figures differ.
            await run(
              `UPDATE research
                  SET market_size = ?::jsonb || CASE WHEN jsonb_typeof(market_size) = 'object'
                        THEN jsonb_strip_nulls(jsonb_build_object(
                             'approved', market_size->'approved',
                             'approved_at', market_size->'approved_at',
                             'approved_value', market_size->'approved_value'))
                        ELSE '{}'::jsonb END,
                      sources = COALESCE(?, sources), researched_at = CURRENT_TIMESTAMP
                WHERE project_id = ?`,
              sizing, srcJson, ctx.projectId,
            );
          } else {
            await run(
              'INSERT INTO research (project_id, market_size, sources) VALUES (?, ?, ?)',
              ctx.projectId, sizing, srcJson,
            );
          }
          sizingTarget = 'research.market_size';
        }
        const r = await autoStageValidationFromArtifact(ctx.projectId, artifact);
        const valTarget = r.staged ? `validation_proposal (auto, ${r.itemCount} item(s))` : '';
        const target = [sizingTarget, valTarget].filter(Boolean).join(' + ');
        return (sizingTarget || r.staged)
          ? { type: artifact.type, persisted: true, target: target || artifact.type, persisted_id: r.pendingActionId }
          : { type: artifact.type, persisted: false, note: 'view-only / already staged — no new proposal' };
      }
      // Investor pipeline: the kanban stays a view over investors/rounds, but
      // each named investor ALSO lands as a PENDING funding_source node so the
      // INVESTITORI satellite is fed by its highest-volume source (audit B7).
      case 'investor-pipeline':
        return await persistInvestorPipeline(ctx, artifact as InvestorPipelineArtifact);
      // These three used to be view-only no-ops on the assumption their data
      // "lives in the canonical table" — true only for the SKILL path. A
      // chat-inline emission (agent proposes a persona / risk matrix / weekly
      // update in conversation) wrote nothing and the content vanished on
      // refresh (ephemerality audit 2026-07-21). Persist into the same
      // canonical tables the skills use, merge-not-clobber.
      case 'persona-card':
        return await persistPersonaCard(ctx, artifact as PersonaCard);
      case 'risk-matrix':
        return await persistRiskMatrix(ctx, artifact as RiskMatrixArtifact);
      case 'weekly-update':
        return await persistWeeklyUpdate(ctx, artifact as WeeklyUpdateArtifact);
      default:
        return { type: artifact.type, persisted: false, note: 'no handler' };
    }
  } catch (err) {
    console.warn(`[artifact-persistence] ${artifact.type} failed:`, (err as Error).message);
    return { type: artifact.type, persisted: false, note: (err as Error).message };
  }
}

// ─── entity-card → graph_nodes + graph_edges ─────────────────────────────────

// Section headings and option-set labels that leaked into the graph as nodes
// (the founder's 2026-06 complaint: "opzioni target", "opzioni vantaggio
// competitivo", "market sizing" showing up as graph nodes alongside real
// competitors). These are dimensions/headings, not named entities — a real
// node has a proper name. Conservative match: option-set prefixes + a few exact
// heading phrases. Market sizing belongs in research.market_size, not the graph.
const JUNK_NODE_NAME = [
  /^opzion[ei]\b/i,          // "opzione/opzioni …" (Italian option-set labels)
  /^option[s]?\b/i,           // "option/options …"
  /^(market sizing|market size|dimensione (di|del) mercato|dimensionamento|mercato (totale|indirizzabile|obiettivo))\b/i,
  /^(tam|sam|som)\b/i,
  /^(vantaggio competitivo|competitive advantage)$/i,
  /^(target|target market|mercato target|segmento target)$/i,
  /^(value proposition|proposta di valore|problema|problem|soluzione|solution)$/i,
];

function isJunkEntityName(name: string): boolean {
  const n = name.trim();
  if (n.length < 2) return true;
  return JUNK_NODE_NAME.some(re => re.test(n));
}

// entity_type variants the model emits → canonical GraphNodeType values, so
// new nodes land in the right macro-category satellite instead of the
// business_essentials fallback. Unknown types pass through unchanged (the
// category mapper has its own fallback); an absent type defaults to
// business_essential (was the legacy 'entity').
const ENTITY_TYPE_ALIAS: Record<string, string> = {
  customer: 'persona',
  investor: 'funding_source',
  funding: 'funding_source',
  vendor: 'supplier',
  hire: 'hr_collaborator',
  hiring: 'hr_collaborator',
  collaborator: 'hr_collaborator',
  employee: 'hr_collaborator',
  brand: 'brand_asset',
  branding: 'brand_asset',
  gtm: 'gtm_strategy',
  go_to_market: 'gtm_strategy',
  channel: 'gtm_strategy',
  segment: 'market_segment',
  entity: 'business_essential',
};

function normalizeEntityType(t: string | undefined): string {
  const key = (t ?? '').trim().toLowerCase();
  if (!key) return 'business_essential';
  return ENTITY_TYPE_ALIAS[key] ?? key;
}

async function persistEntityCard(ctx: PersistContext, a: EntityCard): Promise<PersistResult> {
  if (!a.name) return { type: a.type, persisted: false, note: 'missing name' };

  // Drop option-set / heading junk before it pollutes the graph (see above).
  if (isJunkEntityName(a.name)) {
    return { type: a.type, persisted: false, note: `skipped non-entity heading "${a.name}"` };
  }

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
      // JSONB column — pass the object, not a stringified scalar (see above / pending-actions.ts:505).
      a.attributes ?? {},
      srcJson,
      existing.id,
    );
    return { type: a.type, persisted: true, target: 'graph_nodes (update)', persisted_id: existing.id };
  }

  // Knowledge-as-proposal (2026-06-11 founder directive): chat-surfaced
  // entities are NOT auto-applied. Every new entity-card node persists as
  // 'pending' — a proposal the founder applies (on the card or in the Inbox,
  // costing 0.5 credits) before it enters project knowledge / closes an evidence
  // gate. The per-row competitor extraction below (web-sourced research the
  // founder watched happen) is the one evidence path that still writes
  // 'applied' — it passes reviewedState explicitly.
  const reviewedState: 'pending' = 'pending';

  const nodeType = normalizeEntityType(a.entity_type);
  const id = `node_${crypto.randomUUID().slice(0, 12)}`;
  await run(
    `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, sources, reviewed_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    ctx.projectId,
    a.name,
    nodeType,
    a.summary ?? '',
    // JSONB column — pass the object, not a stringified scalar (see pending-actions.ts:505).
    a.attributes ?? {},
    srcJson,
    reviewedState,
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
    const relation = relationForEntityType(nodeType);
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

// Takes the NORMALIZED entity type (normalizeEntityType) but keeps the legacy
// raw cases (customer/market/investor) for defensive parity with old callers.
function relationForEntityType(t: string | undefined): string {
  switch (t) {
    case 'competitor':         return 'competes_with';
    case 'customer':           return 'serves';
    case 'persona':            return 'targets';
    case 'market':
    case 'market_segment':     return 'operates_in';
    case 'investor':
    case 'funding_source':     return 'funded_by';
    case 'technology':         return 'uses';
    case 'partner':            return 'partners_with';
    case 'supplier':           return 'supplied_by';
    case 'hr_collaborator':    return 'collaborates_with';
    case 'brand_asset':        return 'expresses';
    case 'gtm_strategy':       return 'executes';
    case 'feature':            return 'has_feature';
    case 'business_essential': return 'requires';
    default:                   return 'related_to';
  }
}

// ─── investor-pipeline → graph_nodes (INVESTITORI satellite) ─────────────────

/**
 * Each named investor in a pipeline card becomes a PENDING funding_source node
 * (dedup on LOWER(name), like entity-cards). Pending = a proposal — the founder
 * applies it from knowledge review; nothing enters intelligence without their
 * click. The kanban itself remains a view (investors/rounds stay the canonical
 * fundraising tables).
 */
async function persistInvestorPipeline(ctx: PersistContext, a: InvestorPipelineArtifact): Promise<PersistResult> {
  const entries = Array.isArray(a.investors) ? a.investors : [];
  if (entries.length === 0) return { type: a.type, persisted: false, note: 'no investors in pipeline' };

  const srcJson = sourcesJson(a.sources);
  const root = await get<{ id: string }>(
    "SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",
    ctx.projectId,
  );

  let upserted = 0;
  let lastId: string | undefined;
  for (const inv of entries) {
    const name = typeof inv?.name === 'string' ? inv.name.trim() : '';
    if (!name || isJunkEntityName(name)) continue;

    const attributes: Record<string, unknown> = {};
    if (inv.stage) attributes.stage = inv.stage;
    if (inv.check_size != null) attributes.check_size = inv.check_size;
    if (a.round_type) attributes.round = a.round_type;
    // Follow-up fields (contact, next step, notes) are the founder's working
    // pipeline state — they were dropped before (ephemerality audit
    // 2026-07-21) and existed nowhere once the card scrolled away.
    if (inv.contact_name) attributes.contact_name = inv.contact_name;
    if (inv.next_step) attributes.next_step = inv.next_step;
    if (inv.next_step_date) attributes.next_step_date = inv.next_step_date;
    if (inv.notes) attributes.notes = inv.notes;
    if (a.round_target != null) attributes.round_target = a.round_target;
    if (a.round_status) attributes.round_status = a.round_status;
    if (a.target_close) attributes.target_close = a.target_close;

    const summary = [
      inv.type,
      inv.stage ? `pipeline: ${inv.stage}` : '',
      inv.check_size != null ? `check ~$${inv.check_size.toLocaleString('en-US')}` : '',
      a.round_type ? `round: ${a.round_type}` : '',
      inv.contact_name ? `contact: ${inv.contact_name}` : '',
      inv.next_step ? `next: ${inv.next_step}${inv.next_step_date ? ` (${inv.next_step_date})` : ''}` : '',
    ].filter(Boolean).join(' · ');

    // Dedup + pending insert via the shared upsert (UPDATE preserves an
    // existing node's reviewed_state — a re-emitted pipeline never re-pends
    // an applied investor).
    const id = await upsertGraphNodeFromArtifact(ctx, {
      name,
      nodeType: 'funding_source',
      summary,
      attributes,
      srcJson,
    });
    if (!id) continue;
    upserted += 1;
    lastId = id;

    // root → investor 'funded_by' edge, idempotent. The graph API hides edges
    // to pending nodes — the link materializes when the founder applies.
    if (root) {
      const existingEdge = await get<{ id: string }>(
        `SELECT id FROM graph_edges
          WHERE project_id = ? AND source_node_id = ? AND target_node_id = ? AND relation = 'funded_by'
          LIMIT 1`,
        ctx.projectId, root.id, id,
      );
      if (!existingEdge) {
        await run(
          `INSERT INTO graph_edges (id, project_id, source_node_id, target_node_id, relation, sources)
           VALUES (?, ?, ?, ?, 'funded_by', ?)`,
          `edge_${crypto.randomUUID().slice(0, 12)}`, ctx.projectId, root.id, id, srcJson,
        );
      }
    }
  }

  return upserted > 0
    ? { type: a.type, persisted: true, target: `graph_nodes (funding_source ×${upserted}, pending)`, persisted_id: lastId }
    : { type: a.type, persisted: false, note: 'no named investors to persist' };
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
    // CHAT-ARTIFACT knowledge is a PROPOSAL — it stays 'pending' until the
    // founder applies it (on the card or in the Inbox, costing 0.5 credits).
    // Reverses the prior auto-apply ("Saved ✓") behaviour.
    reviewedState: 'pending',
  });

  return { type: a.type, persisted: true, target: 'memory_facts (observation)', persisted_id: factId || undefined };
}

// ─── gauge-chart → scores.overall_score + benchmark ──────────────────────────

/** scores.* canon is the startup-scoring rubric's 0-100 scale (parseScoreSummary
 *  already writes it). Chat artifacts are prompted with maxScore:10 examples, so
 *  a declared maxScore wins; without one, a value ≤10 is read as the prompt's
 *  0-10 scale (6.8 → 68) and >10 as already-canonical 0-100. Mixed scales here
 *  were founder-visible: the copilot said 6.8 while Home said /100. */
function normalizeScoreTo100(score: number, maxScore?: number): number {
  const max = maxScore && maxScore > 0 ? maxScore : score <= 10 ? 10 : 100;
  return Math.max(0, Math.min(100, (score * 100) / max));
}

async function persistGaugeChart(ctx: PersistContext, a: GaugeChartArtifact): Promise<PersistResult> {
  if (typeof a.score !== 'number') return { type: a.type, persisted: false, note: 'non-numeric score' };

  const normalizedScore = normalizeScoreTo100(a.score, a.maxScore);
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

  await recordScoreHistory(ctx.projectId, normalizedScore, 'gauge-chart');
  return { type: a.type, persisted: true, target: 'scores (overall_score)' };
}

// Titles that mark a score artifact as THE project-level baseline (vs a
// per-dimension or competitor score): must name both a score word and an
// overall/baseline qualifier, EN or IT. Kept tight — a generic "Competitor
// radar" or single-dimension card must never fill scores.overall_score.
const OVERALL_SCORE_TITLE_RE =
  /\b(overall|startup|baseline|complessivo|complessiva|generale)\b[\s\S]*\b(score|scoring|punteggio)\b|\b(score|scoring|punteggio)\b[\s\S]*\b(overall|startup|baseline|complessivo|complessiva|generale)\b/i;

// ─── radar-chart → scores.dimensions (merged JSON) ───────────────────────────

async function persistRadarChart(ctx: PersistContext, a: RadarChartArtifact): Promise<PersistResult> {
  if (!Array.isArray(a.data) || a.data.length === 0) {
    return { type: a.type, persisted: false, note: 'no data points' };
  }

  const incoming: Record<string, number> = {};
  for (const point of a.data) {
    if (point && typeof point.subject === 'string' && typeof point.value === 'number') {
      // Dimension values share the scores 0-100 canon (see normalizeScoreTo100);
      // radar points declare their scale as fullMark when present.
      incoming[point.subject] = normalizeScoreTo100(point.value, point.fullMark);
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

  // When the radar IS the startup-score baseline (title-matched), derive an
  // overall from the dimension average (already normalized to the 0-100 canon
  // above) and BACKFILL it — never clobber a real gauge/prose overall. Without
  // this a scoring run that renders only a radar leaves no baseline and the
  // Stage-1 startup_scoring_baseline check can never pass.
  const dimValues = Object.values(incoming);
  const overallFromDims =
    OVERALL_SCORE_TITLE_RE.test(a.title ?? '') && dimValues.length > 0
      ? dimValues.reduce((s, v) => s + v, 0) / dimValues.length
      : null;

  if (existing) {
    // coerceJson: existing.dimensions may be a legacy double-encoded STRING.
    // Spreading a string enumerates its characters into char-index keys
    // (0:'{',1:'"',…) which compounds on every write — parse first.
    const prior = coerceJson<Record<string, unknown>>(existing.dimensions) || {};
    const merged = { ...prior, ...incoming };
    await run(
      `UPDATE scores SET dimensions = ?,
         overall_score = CASE WHEN (overall_score IS NULL OR overall_score = 0) AND ?::numeric IS NOT NULL THEN ?::numeric ELSE overall_score END,
         sources = COALESCE(?, sources), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?`,
      merged,
      overallFromDims,
      overallFromDims,
      srcJson,
      ctx.projectId,
    );
  } else {
    // A baseline-titled radar fills the overall; a dimensions-only artifact
    // leaves it NULL — never a literal 0, which rendered Home as "0/100 weak"
    // and could not be told apart from a real zero (see stage-1
    // startup_scoring_baseline).
    await run(
      'INSERT INTO scores (project_id, overall_score, dimensions, sources) VALUES (?, ?, ?, ?)',
      ctx.projectId,
      overallFromDims,
      incoming,
      srcJson,
    );
  }
  if (overallFromDims != null && overallFromDims > 0) {
    await recordScoreHistory(ctx.projectId, overallFromDims, 'radar-chart');
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
  // coerceJson guards against legacy double-encoded dimensions (see persistScoreCard).
  const prior = existing ? (coerceJson<Record<string, unknown>>(existing.dimensions) || {}) : {};
  const merged = { ...prior, [a.title]: normalizeScoreTo100(a.score, a.maxScore) };
  const srcJson = sourcesJson(a.sources);

  // A score-card titled as THE baseline/overall score (e.g. "DeskMate —
  // Baseline Startup Score: 6.8") is the startup-scoring result rendered as a
  // card instead of a gauge. Mirror persistGaugeChart: fill overall_score
  // (normalized to the 0-100 canon), otherwise no baseline lands and the
  // Stage-1 startup_scoring_baseline check can never pass.
  const isOverall = OVERALL_SCORE_TITLE_RE.test(a.title);
  const normalizedScore = normalizeScoreTo100(a.score, a.maxScore);

  if (existing) {
    if (isOverall) {
      await run(
        'UPDATE scores SET dimensions = ?, overall_score = ?, sources = COALESCE(?, sources), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
        merged,
        normalizedScore,
        srcJson,
        ctx.projectId,
      );
    } else {
      await run(
        'UPDATE scores SET dimensions = ?, sources = COALESCE(?, sources), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
        merged,
        srcJson,
        ctx.projectId,
      );
    }
  } else {
    // Baseline-titled cards fill the overall; per-dimension cards leave it
    // NULL, never 0 — see persistRadarChart: a fabricated zero baseline
    // poisons Home and the stage-1 scoring check.
    await run(
      'INSERT INTO scores (project_id, overall_score, dimensions, sources) VALUES (?, ?, ?, ?)',
      ctx.projectId,
      isOverall ? normalizedScore : null,
      merged,
      srcJson,
    );
  }
  if (isOverall && normalizedScore > 0) {
    await recordScoreHistory(ctx.projectId, normalizedScore, 'score-card');
  }

  return { type: a.type, persisted: true, target: `scores.dimensions["${a.title}"]` };
}

// ─── persona-card → simulation.personas (merge by name) ──────────────────────

async function persistPersonaCard(ctx: PersistContext, a: PersonaCard): Promise<PersistResult> {
  const name = (a.name ?? '').trim();
  if (!name) return { type: a.type, persisted: false, note: 'no persona name' };

  const entry: Record<string, unknown> = {
    name,
    archetype: a.archetype,
    ...(a.demographics ? { demographics: a.demographics } : {}),
    ...(Array.isArray(a.jobs_to_be_done) && a.jobs_to_be_done.length ? { jobs_to_be_done: a.jobs_to_be_done } : {}),
    ...(Array.isArray(a.pains) && a.pains.length ? { pains: a.pains } : {}),
    ...(Array.isArray(a.channels) && a.channels.length ? { channels: a.channels } : {}),
    ...(a.reaction ? { reaction: a.reaction } : {}),
    ...(typeof a.engagement_score === 'number' ? { engagement_score: a.engagement_score } : {}),
    ...(a.quote ? { quote: a.quote } : {}),
    ...(Array.isArray(a.sources) && a.sources.length ? { sources: a.sources } : {}),
  };

  const existing = await get<{ personas: unknown }>(
    'SELECT personas FROM simulation WHERE project_id = ?', ctx.projectId,
  );

  if (existing) {
    // Merge by name (case-insensitive): update-in-place keeps prior fields the
    // card didn't restate (e.g. a Stage-2 engagement_score survives a Stage-1
    // re-emission of the same persona); unseen names append.
    const prior = coerceJson<Array<Record<string, unknown>>>(existing.personas);
    const list = Array.isArray(prior) ? [...prior] : [];
    const idx = list.findIndex((p) => typeof p?.name === 'string' && p.name.trim().toLowerCase() === name.toLowerCase());
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push(entry);
    await run(
      'UPDATE simulation SET personas = ?, simulated_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      list, ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO simulation (project_id, personas) VALUES (?, ?)',
      ctx.projectId, [entry],
    );
  }
  return { type: a.type, persisted: true, target: `simulation.personas ("${name}")` };
}

// ─── risk-matrix → simulation.risk_scenarios (merge by risk text) ────────────

async function persistRiskMatrix(ctx: PersistContext, a: RiskMatrixArtifact): Promise<PersistResult> {
  const risks = Array.isArray(a.risks)
    ? a.risks.filter((r) => r && typeof r.risk === 'string' && r.risk.trim().length > 0)
    : [];
  if (risks.length === 0) return { type: a.type, persisted: false, note: 'no risks' };

  const existing = await get<{ risk_scenarios: unknown }>(
    'SELECT risk_scenarios FROM simulation WHERE project_id = ?', ctx.projectId,
  );
  const prior = existing ? coerceJson<unknown>(existing.risk_scenarios) : null;

  // The risk-scoring skill's direct endpoint stores its full audit BLOB (an
  // object) here; readers (get_risk_audit, section-scoring) expect an ARRAY.
  // Never clobber a skill audit with a chat matrix — the audit is the richer
  // canonical output; skip and report.
  if (prior != null && !Array.isArray(prior)) {
    return { type: a.type, persisted: false, note: 'skill risk audit present — chat matrix not persisted over it' };
  }

  // Merge by risk id, falling back to normalized risk text — re-emitting the
  // matrix updates entries (mitigation/status edits) instead of duplicating.
  const list: Array<Record<string, unknown>> = Array.isArray(prior) ? [...prior as Array<Record<string, unknown>>] : [];
  const keyOf = (r: Record<string, unknown>): string =>
    (typeof r.id === 'string' && r.id) || String(r.risk ?? '').trim().toLowerCase();
  for (const r of risks) {
    const entry = r as unknown as Record<string, unknown>;
    const idx = list.findIndex((p) => keyOf(p) === keyOf(entry));
    if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    else list.push(entry);
  }

  const srcJson = sourcesJson(a.sources);
  if (existing) {
    await run(
      'UPDATE simulation SET risk_scenarios = ?, scenario_sources = COALESCE(?, scenario_sources), simulated_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      list, srcJson, ctx.projectId,
    );
  } else {
    await run(
      'INSERT INTO simulation (project_id, risk_scenarios, scenario_sources) VALUES (?, ?, ?)',
      ctx.projectId, list, srcJson,
    );
  }
  return { type: a.type, persisted: true, target: `simulation.risk_scenarios (+${risks.length} risk(s))` };
}

// ─── weekly-update → startup_updates ─────────────────────────────────────────

async function persistWeeklyUpdate(ctx: PersistContext, a: WeeklyUpdateArtifact): Promise<PersistResult> {
  const period = (a.period ?? '').trim();
  if (!period) return { type: a.type, persisted: false, note: 'no period' };

  // One row per (project, period): a re-emitted update for the same week
  // refreshes it instead of stacking duplicates in the journey feed.
  const dup = await get<{ id: string }>(
    'SELECT id FROM startup_updates WHERE project_id = ? AND period = ? ORDER BY date DESC LIMIT 1',
    ctx.projectId, period,
  );
  // JSONB: bind raw arrays — JSON.stringify double-encodes (see src/lib/jsonb.ts).
  const metrics = Array.isArray(a.metrics_snapshot) ? a.metrics_snapshot : [];
  const highlights = Array.isArray(a.highlights) ? a.highlights : [];
  const challenges = Array.isArray(a.challenges) ? a.challenges : [];
  const asks = Array.isArray(a.asks) ? a.asks : [];
  const morale = typeof a.morale === 'number' ? a.morale : null;
  const summary = a.generated_summary || null;

  if (dup) {
    await run(
      `UPDATE startup_updates SET metrics_snapshot = ?, highlights = ?, challenges = ?, asks = ?,
              morale = COALESCE(?, morale), generated_summary = COALESCE(?, generated_summary), date = ?
        WHERE id = ?`,
      metrics, highlights, challenges, asks, morale, summary,
      new Date().toISOString().split('T')[0], dup.id,
    );
    return { type: a.type, persisted: true, target: `startup_updates (${dup.id}, refreshed)` };
  }
  const id = generateId('upd');
  await run(
    `INSERT INTO startup_updates (id, project_id, period, metrics_snapshot, highlights, challenges, asks, morale, generated_summary, date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, ctx.projectId, period, metrics, highlights, challenges, asks, morale, summary,
    new Date().toISOString().split('T')[0],
  );
  return { type: a.type, persisted: true, target: `startup_updates (${id})` };
}

// ─── metric-grid → research.market_size (when market-themed) ─────────────────

async function persistMetricGrid(ctx: PersistContext, a: MetricGrid): Promise<PersistResult> {
  if (!Array.isArray(a.metrics) || a.metrics.length === 0) {
    return { type: a.type, persisted: false, note: 'no metrics' };
  }

  const titleText = `${a.title ?? ''}`.toLowerCase();
  // isMarket routes into research.market_size (the TAM/SAM/SOM column) — keep
  // it TIGHT: the previous broad regex (/market|…|size|executive/) landed
  // operational dashboards in the sizing column 3/8 times in prod (audit B3),
  // clobbering real TAM data. Everything else still round-trips as a
  // graph_node below (isOperational / metrics).
  const isMarket = /\b(tam|sam|som|market siz|addressable)/.test(titleText);
  const isOperational = /dashboard|health|kpi|metric|benchmark|funnel|cohort|retention|growth|economics|burn|runway/.test(titleText);

  const marketData = a.metrics.reduce<Record<string, { value: string; change?: string }>>((acc, m) => {
    if (m && typeof m.label === 'string' && typeof m.value === 'string') {
      acc[m.label] = { value: m.value, ...(m.change ? { change: m.change } : {}) };
    }
    return acc;
  }, {});
  const srcJson = sourcesJson(a.sources);

  // Themed routing — only when the title clearly signals market sizing data
  // (research.market_size is the TAM/SAM/SOM column).
  // Bind the RAW object, not JSON.stringify(...) — market_size is JSONB and
  // postgres.js single-encodes bound objects; a pre-stringified bind lands as
  // a jsonb string scalar (the double-encode class, #142).
  if (isMarket) {
    const existing = await get<{ project_id: string }>(
      'SELECT project_id FROM research WHERE project_id = ?',
      ctx.projectId,
    );
    if (existing) {
      // Full-replace, but CARRY the founder's approval stamp across (see the
      // tam-sam-som writer above — approval durability, audit B3).
      await run(
        `UPDATE research
            SET market_size = ?::jsonb || CASE WHEN jsonb_typeof(market_size) = 'object'
                  THEN jsonb_strip_nulls(jsonb_build_object(
                       'approved', market_size->'approved',
                       'approved_at', market_size->'approved_at',
                       'approved_value', market_size->'approved_value'))
                  ELSE '{}'::jsonb END,
                sources = COALESCE(?, sources), researched_at = CURRENT_TIMESTAMP
          WHERE project_id = ?`,
        { ...marketData, _title: a.title },
        srcJson,
        ctx.projectId,
      );
    } else {
      await run(
        'INSERT INTO research (project_id, market_size, sources) VALUES (?, ?, ?)',
        ctx.projectId,
        { ...marketData, _title: a.title },
        srcJson,
      );
    }
  }

  // Universal visibility — every metric-grid also becomes a graph_node so it
  // surfaces in Context > Intelligence regardless of theme. Without this,
  // operational dashboards ("Weekly Health") vanish from Context even though
  // they render in Canvas.
  const nodeId = await upsertGraphNodeFromArtifact(ctx, {
    name: a.title || 'Metrics',
    nodeType: isMarket ? 'research_metric' : isOperational ? 'benchmark' : 'metrics',
    summary: a.metrics.map((m) => `${m.label}: ${m.value}${m.change ? ` (${m.change})` : ''}`).join(' · '),
    attributes: marketData,
    srcJson,
  });

  return {
    type: a.type,
    persisted: true,
    target: isMarket ? 'research.market_size + graph_nodes' : 'graph_nodes',
    persisted_id: nodeId,
  };
}

// ─── comparison-table → research.competitors (when competitor-themed) ────────

async function persistComparisonTable(ctx: PersistContext, a: ComparisonTable): Promise<PersistResult> {
  if (!Array.isArray(a.rows) || !Array.isArray(a.columns)) {
    return { type: a.type, persisted: false, note: 'malformed table' };
  }

  const titleText = `${a.title ?? ''}`.toLowerCase();
  // Widened: competitor analysis is one valid theme, but rankings, gap analyses,
  // and benchmark comparisons are equally common Stage-1..6 outputs and were
  // being silently dropped before.
  const isCompetitive = /competitor|vs\.?|compare|platform|alternatives/.test(titleText);
  const isRankingOrGap = /ranking|gap|benchmark|analysis|matrix|tier|channel/.test(titleText);

  const rowData = a.rows.map((r) => ({
    name: r.label,
    attributes: a.columns.reduce<Record<string, unknown>>((acc, col, i) => {
      acc[col] = r.values?.[i];
      return acc;
    }, {}),
  }));
  const srcJson = sourcesJson(a.sources);

  // Themed routing — only when the title clearly signals competitor data
  // (research.competitors is consumed by loadMonitorContext as a competitor list).
  if (isCompetitive) {
    const existing = await get<{ project_id: string }>(
      'SELECT project_id FROM research WHERE project_id = ?',
      ctx.projectId,
    );
    // Bind the RAW array, not JSON.stringify(...) — competitors is JSONB and
    // postgres.js single-encodes bound values; a pre-stringified bind lands as
    // a jsonb string scalar (the double-encode class, #142), which
    // loadMonitorContext's `parsed.map(c => c.name)` reader silently empties.
    if (existing) {
      await run(
        'UPDATE research SET competitors = ?, sources = COALESCE(?, sources), researched_at = CURRENT_TIMESTAMP WHERE project_id = ?',
        rowData,
        srcJson,
        ctx.projectId,
      );
    } else {
      await run(
        'INSERT INTO research (project_id, competitors, sources) VALUES (?, ?, ?)',
        ctx.projectId,
        rowData,
        srcJson,
      );
    }
  }

  // Universal visibility — every comparison-table also becomes a graph_node
  // so it surfaces in Context > Intelligence regardless of theme.
  const nodeId = await upsertGraphNodeFromArtifact(ctx, {
    name: a.title || 'Comparison',
    nodeType: isCompetitive ? 'competitor_set' : isRankingOrGap ? 'benchmark' : 'comparison',
    summary: `${a.columns.join(' × ')} — ${rowData.length} rows`,
    attributes: { columns: a.columns, rows: rowData },
    srcJson,
  });

  // Per-row competitor extraction — the Stage-2 journey gate
  // (competitors_mapped, src/lib/journey/snapshot.ts) counts individual
  // graph_nodes with node_type='competitor' AND reviewed_state='applied'.
  // A single 'competitor_set' summary node leaves that gate at 0, so we also
  // surface each competitor as its own node. Per the 2026-06-12 founder-
  // approval directive these rows persist as 'pending' PROPOSALS — they appear
  // in the founder's review surface but do NOT count toward the gate until the
  // founder approves them, so an agent-emitted table can't silently turn the
  // spine green. Fires whenever the table plausibly compares competitors —
  // sources-less tables stage too (rows stay pending; the founder's approval is
  // the gate, not provenance); wrapped so a malformed table can never break the
  // rest of the flush.
  let extracted = 0;
  const headerText = `${titleText} ${a.columns.join(' ').toLowerCase()}`;
  const isCompetitorTable =
    /competitor|alternative|rival|incumbent|player|landscape/.test(headerText) ||
    /\bvs\b/.test(titleText);
  if (isCompetitorTable) {
    try {
      extracted = await extractCompetitorRows(ctx, a, srcJson);
    } catch (err) {
      console.warn('[artifact-persistence] competitor row extraction failed (non-fatal):', err);
    }
  }

  const baseTarget = isCompetitive ? `research.competitors (${rowData.length}) + graph_nodes` : 'graph_nodes';
  return {
    type: a.type,
    persisted: true,
    target: extracted > 0 ? `${baseTarget} + ${extracted} pending competitor node(s)` : baseTarget,
    persisted_id: nodeId,
  };
}

/** Noise guard — never mint more than this many competitor nodes per table. */
const MAX_COMPETITOR_ROWS_PER_TABLE = 6;

/**
 * Upsert each row of a competitor comparison-table as its own
 * graph_node (node_type='competitor', reviewed_state='pending' on insert —
 * the upsert helper's UPDATE path preserves an existing node's state).
 * Founder-approval gate (2026-06-12 directive): nothing turns a journey-spine
 * substep green without explicit founder approval, so chat-emitted competitor
 * rows persist as PROPOSALS. They only count toward the Stage-2
 * competitors_mapped gate (which requires reviewed_state='applied', see
 * src/lib/journey/snapshot.ts) after the founder approves them — an
 * agent-emitted comparison-table can no longer silently turn the spine green.
 * Skips the founder's own product row when identifiable from the 'your_startup'
 * root node or a self-referential label. Dedup is the helper's
 * (project_id, LOWER(name)) match, so re-emissions update in place.
 * Returns the number of rows persisted.
 */
async function extractCompetitorRows(
  ctx: PersistContext,
  a: ComparisonTable,
  srcJson: Source[] | null,
): Promise<number> {
  const root = await get<{ name: string }>(
    "SELECT name FROM graph_nodes WHERE project_id = ? AND node_type = 'your_startup' LIMIT 1",
    ctx.projectId,
  );
  const selfName = (root?.name ?? '').trim().toLowerCase();
  const selfRefRe = /^(you|we|us|your\s+(startup|product|company|idea)|our\s+(startup|product|company|idea))$/;

  let extracted = 0;
  for (const row of a.rows) {
    if (extracted >= MAX_COMPETITOR_ROWS_PER_TABLE) break;
    const name = typeof row?.label === 'string' ? row.label.trim() : '';
    if (!name) continue;
    const lower = name.toLowerCase();
    if ((selfName && lower === selfName) || selfRefRe.test(lower)) continue;

    const values = Array.isArray(row.values) ? row.values : [];
    const summary = a.columns
      .map((col, i) => `${col}: ${values[i] ?? '—'}`)
      .join('; ')
      .slice(0, 300);
    const attributes = a.columns.reduce<Record<string, unknown>>((acc, col, i) => {
      acc[col] = values[i];
      return acc;
    }, {});

    const id = await upsertGraphNodeFromArtifact(ctx, {
      name,
      nodeType: 'competitor',
      summary,
      attributes,
      srcJson,
      // Founder-approval gate (2026-06-12 directive): mirror the entity-card
      // path (persistEntityCard) — chat-surfaced competitors are PROPOSALS,
      // not auto-applied evidence. Persisting 'pending' keeps them out of the
      // Stage-2 competitors_mapped count (which filters reviewed_state='applied'
      // in src/lib/journey/snapshot.ts) until the founder explicitly approves,
      // so an agent-emitted table can't silently turn the spine green.
      reviewedState: 'pending',
    });
    if (id) {
      extracted++;
      // Matryoshka breakdown (item 14): decompose the row's columns into
      // categories hung off this competitor node. Best-effort — never breaks
      // the competitor persist if the categories write fails.
      await persistCompetitorCategories(ctx.projectId, id, attributes, a.sources);
    }
  }
  return extracted;
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
      // The structured parameters of the suggested action (query, target, …).
      // Dropped before (ephemerality audit 2026-07-21): without them the inbox
      // row could describe the action but never re-execute it.
      ...(a.action_payload && typeof a.action_payload === 'object' ? { action_payload: a.action_payload } : {}),
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
    { viewport: a.viewport ?? 'desktop' },
    a.sources ?? [],
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
    { sections_count: a.sections?.length ?? 0 },
    a.sources ?? [],
    new Date().toISOString(),
  );

  return { type: a.type, persisted: true, target: `build_artifacts (${id}, ${a.doc_type})` };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// safeJson is no longer needed — dimensions is JSONB and postgres.js returns
// it as an already-parsed object. Removed.

/**
 * Deterministic fallback for the project score. The startup-scoring skill often
 * emits its scorecard as PROSE ("Overall Score: 57 / 100") instead of a
 * gauge-chart artifact, so scores.overall_score stays null and the Home score
 * never appears — even on a successful run. Parses via parseScoreSummary and
 * persists, ONLY when a real gauge-chart score isn't already there this run.
 * `force` skips that guard: a founder RE-scoring must refresh overall/dimensions
 * (the >0-exists guard silently dropped every second run before).
 * Returns true if it wrote.
 */
export async function persistScoreFromSummary(projectId: string, summary: string, opts: { force?: boolean } = {}): Promise<boolean> {
  const existing = await get<{ overall_score: number | null }>(
    'SELECT overall_score FROM scores WHERE project_id = ?', projectId);
  if (!opts.force && existing && typeof existing.overall_score === 'number' && existing.overall_score > 0) return false;

  const parsed = parseScoreSummary(summary);
  if (!parsed) return false;
  const { overall, dimensions: dimsArg, recommendation, benchmark } = parsed;

  if (existing) {
    await run(
      'UPDATE scores SET overall_score = ?, dimensions = COALESCE(?, dimensions), benchmark = COALESCE(?, benchmark), recommendation = COALESCE(?, recommendation), scored_at = CURRENT_TIMESTAMP WHERE project_id = ?',
      overall, dimsArg, benchmark, recommendation, projectId,
    );
  } else {
    await run(
      'INSERT INTO scores (project_id, overall_score, dimensions, benchmark, recommendation, scored_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      projectId, overall, dimsArg ?? {}, benchmark, recommendation,
    );
  }
  // Append to the trajectory (score-history) so the score-over-time is durable.
  await recordScoreHistory(projectId, overall, 'startup-scoring', recommendation);
  return true;
}
