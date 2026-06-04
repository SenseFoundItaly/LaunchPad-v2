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
  | 'monitor-proposal'
  | 'budget-proposal'
  | 'task'
  | 'html-preview'
  | 'document'
  | 'solve-progress'
  | 'persona-card'
  | 'risk-matrix'
  | 'idea-canvas'
  | 'tam-sam-som'
  | 'investor-pipeline'
  | 'weekly-update';

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

export type ReviewedState = 'pending' | 'applied' | 'rejected';

/**
 * Canvas department — the macro area an artifact belongs to. Canvas groups
 * artifacts by department instead of by turn. Closed set of 6 to keep the
 * navigation surface flat. Memory is auto-routed (facts only); the other 5
 * are agent-declared with a type-based fallback in the parser.
 */
export type Department = 'market' | 'product' | 'pricing' | 'finance' | 'growth' | 'memory';

export interface ArtifactBase {
  type: ArtifactType;
  id: string;
  /** Canvas grouping. Required on every artifact except `option-set` / `fact`
   *  / `task` / `solve-progress` (which don't render in the department grid).
   *  Falls back to type-based classifier in the parser if omitted. */
  department?: Department;
  /** Set when the artifact has been persisted (graph_nodes, memory_facts, etc.) */
  persisted_id?: string;
  /** Review state — pending items await founder review before entering agent context */
  reviewed_state?: ReviewedState;
  /**
   * 'fallback' = sources[] was empty in the raw artifact and was repaired from
   * the trailing <CITATIONS> response block. UI should mark the card so the
   * founder knows the evidence is response-level, not card-level.
   * Undefined = sources came directly from the agent on the artifact.
   */
  provenance?: 'fallback';
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

/**
 * Column type for typed rendering in ComparisonTable and tabular reviews.
 * - text: plain string (default)
 * - currency: number formatted as $X,XXX or $X.XM
 * - percentage: number formatted as X.X%
 * - score: number rendered with color-coded bar (0-10 scale)
 * - url: string rendered as a clickable link
 */
export type ColumnType = 'text' | 'currency' | 'percentage' | 'score' | 'url';

export interface ComparisonTable extends ArtifactBase {
  type: 'comparison-table';
  title: string;
  columns: string[];
  /** Parallel to `columns` — specifies the type of each column for typed
   *  cell rendering. When absent, all columns default to 'text' (backward
   *  compatible with existing comparison-table artifacts). */
  column_types?: ColumnType[];
  rows: { label: string; values: (string | number)[] }[];
  // REQUIRED — every competitor/option compared needs sourcing.
  sources: Source[];
  /** When set, this review was persisted to tabular_reviews for cross-turn reference. */
  review_id?: string;
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
 * Apply / Edit-before-applying / Dismiss directly from the chat thread.
 *
 * Every monitor-proposal artifact pairs with a `pending_actions` row
 * (`action_type='configure_monitor'`) so the proposal persists across
 * sessions. Clicking Apply in either surface resolves both.
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
 *     the justification before applying.
 */
export interface MonitorProposalArtifact extends ArtifactBase {
  type: 'monitor-proposal';
  // v1: 'create' only. 'edit' reserved for v2 (pause/resume/delete flows).
  action: 'create' | 'edit';
  // Present on edit (points at existing monitor); absent on create.
  monitor_id?: string;

  name: string;
  /** One-sentence "why this monitor exists" — the human-readable objective
   *  shown in the Inbox review pane and the /monitors/{id} detail view.
   *  Required on new proposals; nullable on older payloads that pre-date
   *  the field (executor / reader derives a fallback from linked_quote). */
  objective?: string;
  kind: 'competitor' | 'regulation' | 'market' | 'partner' | 'technology' | 'funding' | 'custom';
  schedule: 'daily' | 'weekly';
  query?: string;
  urls_to_track?: string[];
  alert_threshold: string;

  // Derisking linkage — exactly one of the two must be present. linked_risk_id
  // = 'ad_hoc' signals a founder-chat-origin monitor; then linked_quote is
  // required (verbatim founder statement) so the provenance is never broken.
  linked_risk_id: string;
  linked_quote?: string;

  // Populated server-side when L2 dedup fired but was overridden. The founder
  // sees a prominent warning banner on the review card before clicking
  // Apply — never a silent bypass.
  overlap_warning?: {
    existing_monitor_id: string;
    existing_name: string;
    overlap_score: number;
    reason: string;
  };

  // Estimated monthly cost in EUR based on schedule × avg-runs × balanced-tier.
  // Surfaces on the card so the founder sees the ongoing spend implication.
  estimated_monthly_cost_eur: number;
  // Credit-denominated cost — computed using the project's own
  // credits-per-EUR ratio at proposal time. The card displays these
  // prominently because credits are the founder-facing unit.
  // Fields are optional for backwards-compat with older artifacts emitted
  // before this addition; the card falls back to monthly_cost_eur display.
  estimated_daily_credits?: number;
  estimated_monthly_credits?: number;
  estimated_per_run_credits?: number;

  // Pairs the artifact to the inbox row — clicking Apply in either place
  // resolves both. The chat route writes the pending_action first, then
  // emits the artifact with the id embedded.
  pending_action_id: string;

  // REQUIRED (Phase A-F mandate) — every monitor-proposal cites the risk
  // audit entry or founder quote that motivated it. Agent cannot propose
  // a monitor out of thin air.
  sources: Source[];
}

/**
 * `budget-proposal` — in-chat inline card representing an agent-proposed
 * change to the project's monthly LLM budget cap. Mirrors the monitor-proposal
 * pattern: artifact pairs with a `pending_actions` row
 * (`action_type='configure_budget'`); founder applies/edits/dismisses from
 * either surface. The executor UPSERTs `project_budgets.cap_llm_usd` for the
 * current period_month.
 *
 * The agent emits this when the founder asks to raise/lower the cap, OR when
 * the credits-empty error surfaces in conversation. It is never a silent
 * mutation — always surfaces for review.
 */
export interface BudgetProposalArtifact extends ArtifactBase {
  type: 'budget-proposal';
  pending_action_id: string;
  current_cap_usd: number;
  proposed_cap_usd: number;
  reason: string;
  estimated_monthly_cost_usd?: number;
  // REQUIRED — every budget bump cites the founder ask or the credits-empty
  // error that motivated it. Caps are not raised silently.
  sources: Source[];
}

/**
 * `task` — founder-facing TODO surfaced in chat and persisted as a
 * `pending_actions` row with action_type='task'. Sources OPTIONAL: a task
 * is a directive ("draft the seed deck"), not a factual claim — though when
 * it springs from analysis the agent SHOULD cite the analysis that motivated
 * it so the founder can judge urgency.
 *
 * Pairs with the inbox row via `pending_action_id`, mirroring the
 * monitor-proposal pattern. The TaskCard component renders Mark done /
 * Snooze / Dismiss against the same PATCH /actions/[id] endpoint.
 */
export interface TaskArtifact extends ArtifactBase {
  type: 'task';
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  // ISO date or natural language ("this week", "by Friday") — surfaced as-is.
  due?: string;
  // Set server-side after persistence; threaded back into the inline card so
  // Mark done / Snooze / Dismiss can PATCH the matching pending_actions row.
  pending_action_id?: string;
  // --- Expansion fields (Phase G). All optional → backwards-compatible.
  // Populated ONLY when the founder clicks "Expand" on the TaskCard; the
  // server endpoint runs an LLM turn that decomposes the title into a plan
  // and UPDATEs the pending_actions.payload with these fields. Presence of
  // `expanded_at` is the idempotency key — a second Expand click is a 409.
  /** Long-form context, ~200-500 chars. Grounded in the founder's idea. */
  details?: string;
  /** 3-7 actionable verb-first steps, each <120 chars. */
  subtasks?: string[];
  /** Skills / research / founder quotes the expansion cited. */
  references?: Source[];
  /** One of: '30 minutes', '1 hour', 'half a day', '1 day', '2-3 days', '1 week', '2+ weeks'. */
  estimated_effort?: string;
  /** ISO timestamp — presence signals the expansion has run at least once. */
  expanded_at?: string;
  // Optional — see header comment.
  sources?: Source[];
}

/**
 * `html-preview` — a self-contained HTML page (landing page, prototype).
 * Rendered in a sandboxed iframe with viewport toggle. Generated by Build
 * skills (build-landing-page). Sources optional — it's a deliverable, not
 * a factual claim.
 */
export interface HtmlPreviewArtifact extends ArtifactBase {
  type: 'html-preview';
  html: string;
  title: string;
  viewport?: 'desktop' | 'mobile' | 'tablet';
  sources?: Source[];
}

/**
 * `document` — structured text document (pitch deck, one-pager, executive
 * summary). `doc_type` discriminates the template. Sections carry optional
 * heading/body pairs for slide or section navigation. Sources optional.
 */
export interface DocumentArtifact extends ArtifactBase {
  type: 'document';
  title: string;
  doc_type: string;
  content: string;
  sections?: { heading: string; body: string }[];
  sources?: Source[];
}

/**
 * `solve-progress` — UI-only pipeline tracker for the Solve Flow.
 * Shows Research → Analysis → Deliverable stages. Not persisted to DB;
 * state lives in chat messages. Each stage update replaces the previous
 * solve-progress artifact in the canvas.
 */
export type SolveStageStatus = 'pending' | 'active' | 'completed' | 'skipped';

export interface SolveStage {
  id: string;
  label: string;
  status: SolveStageStatus;
  skill_id?: string;
  summary?: string;
}

export interface SolveProgressArtifact extends ArtifactBase {
  type: 'solve-progress';
  active_stage: string;
  stages: SolveStage[];
  started_at: string;
  sources?: Source[];
}

/**
 * PersonaCard — unified shape for buyer personas (Stage 1, scientific-validation)
 * and simulation personas (Stage 2, simulation).
 *
 * Planning fields (demographics, jobs_to_be_done, pains, channels) describe who
 * the persona IS — used by Stage 1 for empathy mapping.
 *
 * Validation fields (reaction, engagement_score, quote) describe how they
 * RESPOND — populated by Stage 2 after the simulation run. engagement_score
 * is on a 1-10 scale, matching `simulation.personas[].engagement_score`.
 */
export interface PersonaCard extends ArtifactBase {
  type: 'persona-card';
  name: string;
  archetype: 'customer' | 'investor' | 'expert' | 'competitor';
  demographics?: string;
  jobs_to_be_done?: string[];
  pains?: string[];
  channels?: string[];
  reaction?: string;
  engagement_score?: number;
  quote?: string;
  // REQUIRED — personas are claims about real-world segments. Stage 1 personas
  // cite market research; Stage 2 personas cite the simulation skill run.
  sources: Source[];
}

/**
 * RiskMatrix — visualizes a set of risks on a 5×5 probability × impact grid.
 *
 * Shape mirrors `simulation.risk_scenarios[]` produced by the risk-scoring
 * skill (see launchpad-skills/risk-scoring/SKILL.md). probability and impact
 * are 1-5 integers; risk_score is their product (1-25). One card shows the
 * full audit — plotting risks individually as separate cards would defeat the
 * matrix's purpose, which is comparison at a glance.
 */
export interface RiskScenarioEntry {
  id: string;
  dimension: 'market' | 'technical' | 'regulatory' | 'team' | 'financial' | 'dependency';
  risk: string;
  probability: number;
  impact: number;
  risk_score?: number;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  narrative?: string;
  mitigation?: string;
  mitigation_owner?: string;
  mitigation_due?: string;
  status?: 'new' | 'in_progress' | 'mitigated' | 'accepted';
}

export interface RiskMatrixArtifact extends ArtifactBase {
  type: 'risk-matrix';
  title: string;
  risks: RiskScenarioEntry[];
  overall_assessment?: string;
  // REQUIRED — every plotted risk is a claim about a real failure mode and
  // must be backed by web/skill/inference provenance.
  sources: Source[];
}

/**
 * IdeaCanvas — Lean Canvas-style 9-block grid populated from the
 * `idea_canvas` table. Used by Stage 1 idea-shaping skill. All blocks are
 * optional so the card renders progressively as the founder fills in detail.
 */
export interface IdeaCanvasArtifact extends ArtifactBase {
  type: 'idea-canvas';
  title: string;
  problem?: string;
  solution?: string;
  target_market?: string;
  value_proposition?: string;
  competitive_advantage?: string;
  unfair_advantage?: string;
  business_model?: string;
  key_metrics?: string[];
  revenue_streams?: string[];
  cost_structure?: string[];
  sources?: Source[];
}

/**
 * TamSamSom — concentric market-size visual.
 *
 * `value` is a free-form string ("$2.4B", "€500M-€2B") because the
 * market-research skill emits estimates with units and ranges, not raw
 * numbers. `numeric_usd` is the agent's optional best-guess parsed number
 * (in USD) used ONLY for sizing the concentric circles — never displayed.
 */
export interface MarketSizeTier {
  value: string;
  numeric_usd?: number;
  methodology?: string;
  confidence?: 'low' | 'medium' | 'high';
}

export interface TamSamSomArtifact extends ArtifactBase {
  type: 'tam-sam-som';
  title: string;
  tam: MarketSizeTier;
  sam: MarketSizeTier;
  som: MarketSizeTier;
  timeframe?: string;
  market_share_implied?: string;
  // REQUIRED — TAM/SAM/SOM numbers are factual claims that must be sourceable.
  sources: Source[];
}

/**
 * InvestorPipeline — kanban-style view of fundraising prospects grouped by
 * stage. Stages match the `investors.stage` enum from the schema.
 */
export type InvestorStage = 'target' | 'contacted' | 'meeting' | 'interested' | 'committed' | 'passed';

export interface InvestorEntry {
  id: string;
  name: string;
  type?: string;
  stage: InvestorStage;
  check_size?: number;
  contact_name?: string;
  next_step?: string;
  next_step_date?: string;
  notes?: string;
}

export interface InvestorPipelineArtifact extends ArtifactBase {
  type: 'investor-pipeline';
  title: string;
  investors: InvestorEntry[];
  round_target?: number;
  round_type?: string;
  round_status?: string;
  target_close?: string;
  sources?: Source[];
}

/**
 * WeeklyUpdate — structured weekly/period update mirroring the
 * `startup_updates` table. Morale is 1-10. Lists are short bullet strings.
 */
export interface WeeklyUpdateArtifact extends ArtifactBase {
  type: 'weekly-update';
  title: string;
  period: string;
  morale?: number;
  metrics_snapshot?: { label: string; value: string; delta?: string }[];
  highlights?: string[];
  challenges?: string[];
  asks?: string[];
  generated_summary?: string;
  sources?: Source[];
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
  | MonitorProposalArtifact
  | BudgetProposalArtifact
  | TaskArtifact
  | HtmlPreviewArtifact
  | DocumentArtifact
  | SolveProgressArtifact
  | PersonaCard
  | RiskMatrixArtifact
  | IdeaCanvasArtifact
  | TamSamSomArtifact
  | InvestorPipelineArtifact
  | WeeklyUpdateArtifact;

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
  'budget-proposal',
  'persona-card',
  'risk-matrix',
  'tam-sam-som',
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
