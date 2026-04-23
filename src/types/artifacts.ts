export type ArtifactType =
  | 'option-set'
  | 'insight-card'
  | 'comparison-table'
  | 'action-suggestion'
  | 'score-badge'
  | 'entity-card'
  | 'workflow-card'
  | 'radar-chart'
  | 'bar-chart'
  | 'pie-chart'
  | 'gauge-chart'
  | 'score-card'
  | 'metric-grid'
  | 'sensitivity-slider'
  | 'fact'
  | 'monitor-proposal';

/**
 * Source — verifiable provenance for every factual claim the agent makes.
 *
 * Enforced across artifacts (via parser) and prose (via [N] inline markers).
 * The five variants cover the full spectrum of provenance:
 *
 *   - web: external evidence (URL from web_search / read_url / Jina). The
 *     default for market claims, competitor data, benchmarks.
 *   - skill: a prior skill run (e.g., "per market-research 2026-04-15").
 *     Chains back to whatever that skill cited.
 *   - internal: project data the founder owns (scores, research rows, graph
 *     nodes, memory facts). Auditable inside the app.
 *   - user: founder said it (verbatim quote from a chat turn). Required
 *     for claims like "founder committed to Bohm pilot by May 31."
 *   - inference: agent synthesized across sources. MUST carry based_on
 *     recursively so the audit trail never terminates in "trust me." A
 *     lone `inference` with empty based_on is rejected by the parser.
 *
 * `title` is always required — it's what the UI renders in the chip.
 * `quote` is optional verbatim text that lets the founder verify the claim
 *   against the source without clicking through.
 */
export type Source =
  | { type: 'web'; title: string; url: string; accessed_at?: string; quote?: string }
  | { type: 'skill'; title: string; skill_id: string; run_id?: string; quote?: string }
  | {
      type: 'internal';
      title: string;
      ref: 'graph_node' | 'score' | 'research' | 'memory_fact' | 'chat_turn';
      ref_id: string;
      quote?: string;
    }
  | { type: 'user'; title: string; chat_turn_id?: string; quote: string }
  | { type: 'inference'; title: string; based_on: Source[]; reasoning: string };

export interface ArtifactBase {
  type: ArtifactType;
  id: string;
}

export interface OptionSet extends ArtifactBase {
  type: 'option-set';
  prompt: string;
  options: { id: string; label: string; description: string }[];
  // Optional — option-sets are UI interaction, not factual claims.
  sources?: Source[];
}

export interface InsightCard extends ArtifactBase {
  type: 'insight-card';
  category: 'competitor' | 'market' | 'risk' | 'opportunity' | 'technology';
  title: string;
  body: string;
  confidence: 'low' | 'medium' | 'high';
  // REQUIRED — insight cards make factual claims about markets, competitors,
  // risks. Must cite at least one source.
  sources: Source[];
}

export interface ComparisonTable extends ArtifactBase {
  type: 'comparison-table';
  title: string;
  columns: string[];
  rows: { label: string; values: string[] }[];
  // REQUIRED — every competitor/option compared needs sourcing.
  sources: Source[];
}

export interface ActionSuggestion extends ArtifactBase {
  type: 'action-suggestion';
  title: string;
  description: string;
  action_label: string;
  action_type: 'research' | 'score' | 'simulate' | 'deep-dive' | 'custom';
  action_payload?: Record<string, unknown>;
  // REQUIRED — an action suggestion is synthesized from analysis; cite
  // what analysis motivated it so the founder can judge the action's basis.
  sources: Source[];
}

export interface ScoreBadge extends ArtifactBase {
  type: 'score-badge';
  label: string;
  score: number;
  max: number;
  // REQUIRED — any displayed score is a factual claim about performance.
  sources: Source[];
}

export interface EntityCard extends ArtifactBase {
  type: 'entity-card';
  name: string;
  entity_type: string;
  summary: string;
  attributes: Record<string, unknown>;
  relationships?: { target: string; relation: string }[];
  // REQUIRED — every named entity (competitor, customer, partner) must
  // cite where the claim about its existence + attributes comes from.
  sources: Source[];
}

export interface WorkflowCard extends ArtifactBase {
  type: 'workflow-card';
  title: string;
  category: 'hiring' | 'marketing' | 'fundraising' | 'product' | 'legal' | 'operations' | 'sales';
  description: string;
  priority: 'high' | 'medium' | 'low';
  steps: string[];
  // REQUIRED — a proposed workflow is synthesis; must cite the analysis
  // or data that motivated it so the founder knows why to run it.
  sources: Source[];
}

export interface RadarChartArtifact extends ArtifactBase {
  type: 'radar-chart';
  title: string;
  data: { subject: string; value: number; fullMark?: number }[];
  // REQUIRED — every dimension value is a factual claim.
  sources: Source[];
}

export interface BarChartArtifact extends ArtifactBase {
  type: 'bar-chart';
  title: string;
  data: { name: string; value: number }[];
  // REQUIRED.
  sources: Source[];
}

export interface PieChartArtifact extends ArtifactBase {
  type: 'pie-chart';
  title: string;
  data: { name: string; value: number }[];
  // REQUIRED.
  sources: Source[];
}

export interface GaugeChartArtifact extends ArtifactBase {
  type: 'gauge-chart';
  title: string;
  score: number;
  maxScore?: number;
  verdict?: string;
  // REQUIRED — a GO/NO-GO/CAUTION verdict with a score needs sourcing.
  sources: Source[];
}

export interface ScoreCardArtifact extends ArtifactBase {
  type: 'score-card';
  title: string;
  score: number;
  maxScore?: number;
  description?: string;
  // REQUIRED.
  sources: Source[];
}

export interface SensitivitySlider extends ArtifactBase {
  type: 'sensitivity-slider';
  title: string;
  variables: { name: string; min: number; max: number; value: number; unit?: string }[];
  output: { label: string; formula: string };
  // Optional — sliders are interactive what-if tools, not factual claims.
  sources?: Source[];
}

export interface MetricGrid extends ArtifactBase {
  type: 'metric-grid';
  title: string;
  metrics: { label: string; value: string; change?: string }[];
  // REQUIRED — every metric (MRR, CAC, TAM) is a factual claim.
  sources: Source[];
}

/**
 * `fact` — an agent-extracted durable fact to persist in memory_facts.
 * Not rendered as a visible artifact; the chat route intercepts these and
 * calls recordFact() before sending the message to the client.
 */
export interface FactArtifact extends ArtifactBase {
  type: 'fact';
  fact: string;
  kind?: 'fact' | 'decision' | 'observation' | 'note' | 'preference';
  confidence?: number;
  // REQUIRED — a durable fact written into memory MUST carry provenance.
  // Silently unsourced facts contaminate the memory layer for future turns.
  sources: Source[];
}

/**
 * `monitor-proposal` — in-chat inline card representing an agent-proposed
 * recurring monitor tied to a specific derisking goal. The founder can
 * Approve / Edit-before-approve / Dismiss directly from the chat thread.
 *
 * Every monitor-proposal artifact pairs with a `pending_actions` row
 * (`action_type='configure_monitor'`) so the proposal persists across
 * sessions. Clicking Approve in either surface resolves both.
 *
 * Derisking linkage (`linked_risk_id` or `linked_quote`) is REQUIRED — a
 * monitor with no risk tie becomes orphaned noise. Enforced at the
 * `propose_monitor` tool schema level (TypeBox) and again at the
 * server-side dedup layer before the artifact is emitted.
 *
 * Dedup:
 *   - L1 (SQL): (project_id, linked_risk_id, kind) uniqueness + URL-set
 *     intersection check. Runs in propose_monitor.execute() before artifact
 *     emission. Failures return an error tool_result rather than a card.
 *   - L2 (Haiku classifier): semantic overlap check at overlap_score >= 0.7.
 *     When triggered but overridden (dedup_override: true), the reason
 *     surfaces in `overlap_warning` on the artifact so the founder sees
 *     the justification before approving.
 */
export interface MonitorProposalArtifact extends ArtifactBase {
  type: 'monitor-proposal';
  // v1: 'create' only. 'edit' reserved for v2 (pause/resume/delete flows).
  action: 'create' | 'edit';
  // Present on edit (points at existing monitor); absent on create.
  monitor_id?: string;

  name: string;
  kind: 'competitor' | 'regulation' | 'market' | 'partner' | 'technology' | 'funding' | 'custom';
  schedule: 'hourly' | 'daily' | 'weekly';
  query?: string;
  urls_to_track?: string[];
  alert_threshold: string;

  // Derisking linkage — exactly one of the two must be present. linked_risk_id
  // = 'ad_hoc' signals a founder-chat-origin monitor; then linked_quote is
  // required (verbatim founder statement) so the provenance is never broken.
  linked_risk_id: string;
  linked_quote?: string;

  // Populated server-side when L2 dedup fired but was overridden. The founder
  // sees a prominent warning banner on the approval card before clicking
  // Approve — never a silent bypass.
  overlap_warning?: {
    existing_monitor_id: string;
    existing_name: string;
    overlap_score: number;
    reason: string;
  };

  // Estimated monthly cost in EUR based on schedule × avg-runs × balanced-tier.
  // Surfaces on the card so the founder sees the ongoing spend implication.
  estimated_monthly_cost_eur: number;

  // Pairs the artifact to the inbox row — clicking Approve in either place
  // resolves both. The chat route writes the pending_action first, then
  // emits the artifact with the id embedded.
  pending_action_id: string;

  // REQUIRED (Phase A-F mandate) — every monitor-proposal cites the risk
  // audit entry or founder quote that motivated it. Agent cannot propose
  // a monitor out of thin air.
  sources: Source[];
}

export type Artifact =
  | OptionSet
  | InsightCard
  | ComparisonTable
  | ActionSuggestion
  | ScoreBadge
  | EntityCard
  | WorkflowCard
  | RadarChartArtifact
  | BarChartArtifact
  | PieChartArtifact
  | GaugeChartArtifact
  | ScoreCardArtifact
  | MetricGrid
  | SensitivitySlider
  | FactArtifact
  | MonitorProposalArtifact;

/**
 * Set of artifact types that MUST have non-empty sources. Parser uses this
 * for runtime validation — if the type is in this set and sources is missing
 * or empty, the artifact is rejected with a visible error segment.
 *
 * Kept as a constant (not derived from individual interfaces) so the parser
 * can check it without needing TypeScript reflection at runtime.
 */
export const ARTIFACTS_REQUIRING_SOURCES: ReadonlySet<ArtifactType> = new Set([
  'insight-card',
  'comparison-table',
  'action-suggestion',
  'score-badge',
  'entity-card',
  'workflow-card',
  'radar-chart',
  'bar-chart',
  'pie-chart',
  'gauge-chart',
  'score-card',
  'metric-grid',
  'fact',
  'monitor-proposal',
]);

/**
 * Validate a Source value matches the discriminated union shape.
 *
 * Returns null if valid, or a human-readable reason if invalid.
 *
 * Depth guard for `inference` sources — an agent could produce pathological
 * recursion (A cites B cites A). Max 4 levels of chain is plenty for any
 * honest reasoning; beyond that we treat it as malformed.
 */
export function validateSource(src: unknown, depth = 0): string | null {
  if (depth > 4) return 'inference chain too deep (max 4 levels)';
  if (!src || typeof src !== 'object') return 'source must be an object';

  const s = src as Record<string, unknown>;
  if (typeof s.title !== 'string' || s.title.length === 0) {
    return 'source.title is required';
  }

  switch (s.type) {
    case 'web':
      if (typeof s.url !== 'string' || !/^https?:\/\//.test(s.url)) {
        return 'web source requires an http(s) url';
      }
      return null;
    case 'skill':
      if (typeof s.skill_id !== 'string' || s.skill_id.length === 0) {
        return 'skill source requires a skill_id';
      }
      return null;
    case 'internal':
      if (typeof s.ref !== 'string' || typeof s.ref_id !== 'string') {
        return 'internal source requires ref + ref_id';
      }
      return null;
    case 'user':
      if (typeof s.quote !== 'string' || s.quote.length === 0) {
        return 'user source requires a verbatim quote';
      }
      return null;
    case 'inference':
      if (!Array.isArray(s.based_on) || s.based_on.length === 0) {
        return 'inference source requires non-empty based_on[]';
      }
      if (typeof s.reasoning !== 'string' || s.reasoning.length === 0) {
        return 'inference source requires reasoning text';
      }
      for (const base of s.based_on) {
        const nested = validateSource(base, depth + 1);
        if (nested) return `inference.based_on[] invalid: ${nested}`;
      }
      return null;
    default:
      return `unknown source.type "${String(s.type)}"`;
  }
}
