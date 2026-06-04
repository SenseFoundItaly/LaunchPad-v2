/**
 * Stages — types for the 7-stage founder journey ("smarcamento").
 *
 * Stages are HORIZONTAL checkpoints across the VERTICAL facet data
 * (Canvas / Intel / Product / Pricing / Finance / Growth). Each stage
 * declares its evidence contract: a list of checks that read the project
 * snapshot and return passed/gap verdicts with source pointers.
 *
 * The founder doesn't see a numeric score — they see "Stage N: 4 of 7
 * checks passed, here's what's missing, here's the next action."
 */

export type StageId =
  | 'spark'
  | 'problem'
  | 'solution'
  | 'segment'
  | 'mvp'
  | 'pricing'
  | 'growth';

/** A single evidence check for a stage. Reads the snapshot, returns a verdict. */
export interface StageCheck {
  id: string;
  /** Human-readable label, e.g. "5+ customer interviews logged". */
  label: string;
  /** Where the evidence lives — surfaced in the UI so the founder sees the
   *  data source, not just the verdict. Examples: "canvas.problem",
   *  "competitor_profiles", "pricing_state.wtp". */
  source: string;
  evaluate: (snapshot: ProjectSnapshot) => CheckResult;
}

export interface CheckResult {
  passed: boolean;
  /** When passed: a short evidence string the UI can render (e.g. "3 of 5
   *  competitors mapped"). When failed: optional gap hint. */
  evidence?: string;
  /** Short hint of what's missing or what to do to pass — only set when
   *  `passed === false`. */
  gap?: string;
}

export interface Stage {
  id: StageId;
  /** 1-based order in the journey. */
  number: number;
  label: string;
  tagline: string;
  checks: StageCheck[];
}

export interface StageEvaluation {
  stage: Stage;
  passed: number;
  total: number;
  /** done = all checks passed. active = first non-done stage. pending = later. */
  status: 'done' | 'active' | 'pending';
  results: Array<{
    check: { id: string; label: string; source: string };
    result: CheckResult;
  }>;
}

/** Snapshot — everything the stage evaluators need to read, fetched once
 *  per evaluation. Keep this lean: only fields that some check reads. */
export interface ProjectSnapshot {
  idea_canvas: {
    problem: string | null;
    solution: string | null;
    target_market: string | null;
    value_proposition: string | null;
    competitive_advantage: string | null;
  } | null;
  competitors: Array<{
    id: string;
    name: string;
    total_signals: number | null;
  }>;
  research: Record<string, unknown> | null;
  monitors: Array<{ id: string; status: string }>;
  pricing_state: {
    anchor_price: number | null;
    tiers: unknown[];
    wtp: Record<string, unknown> | null;
    unit_econ: {
      cac?: number;
      ltv?: number;
      gross_margin?: number;
      payback_months?: number;
    } | null;
    model: string | null;
  } | null;
  burn_rate: {
    monthly_burn: number | null;
    cash_on_hand: number | null;
  } | null;
  workflow: {
    current_step: string | null;
    status: string | null;
  } | null;
  growth_loops: Array<{ id: string; status: string | null }>;
  metrics: Array<{ id: string; name: string; current_value: number | null }>;
  /** Memory facts — qualitative evidence the chat agent has captured.
   *  Tagging convention is loose; checks search by content keyword for now.
   *  Filtered to reviewed_state IN ('accepted','pending') — rejected facts
   *  must not count as evidence. */
  memory_facts: Array<{ id: string; content: string }>;
  /** Structured interviews — Stage 2 evidence. Populated via log_interview
   *  tool from chat or POST /api/projects/[id]/interviews. */
  interviews: Array<{
    id: string;
    person_name: string;
    top_pain: string | null;
    wtp_amount: number | null;
    urgency: string | null;
  }>;
  fundraising_round: {
    target_amount: number | null;
    raised_amount: number | null;
    status: string | null;
  } | null;
  investors: Array<{ id: string; name: string; stage: string | null }>;
  /** Counts of tables we only need cardinality from. Cheaper than fetching rows. */
  counts: {
    published_assets: number;
    pending_actions: number;
    knowledge_items: number;
  };
}
