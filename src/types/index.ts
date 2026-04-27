export interface Project {
  project_id: string;
  name: string;
  description: string;
  status: string;
  current_step: number;
  created_at: string;
  updated_at: string;
  llm_provider: string;
  error: string | null;
}

export interface IdeaCanvas {
  problem: string;
  solution: string;
  target_market: string;
  business_model: string;
  competitive_advantage: string;
  value_proposition: string;
  key_metrics: string[];
  revenue_streams: string[];
  cost_structure: string[];
  unfair_advantage: string;
}

export interface ScoreDimension {
  name: string;
  score: number;
  rationale: string;
  strengths: string[];
  risks: string[];
}

export interface ScoreResult {
  overall_score: number;
  dimensions: ScoreDimension[];
  benchmark_comparison: string;
  top_recommendation: string;
}

export interface Competitor {
  name: string;
  description: string;
  strengths: string[];
  weaknesses: string[];
  funding: string;
  market_share: string;
}

export interface ResearchResult {
  market_size: { tam: string; sam: string; som: string };
  competitors: Competitor[];
  trends: { title: string; description: string; relevance: string; direction: string }[];
  case_studies: { name: string; outcome: string; lessons_learned: string }[];
  key_insights: string[];
}

export interface SimulatedPersona {
  id: string;
  name: string;
  role: string;
  demographics: string;
  profession: string;
  feedback: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  willingness_to_pay: string | null;
  concerns: string[];
  suggestions: string[];
}

export interface RiskScenario {
  title: string;
  probability: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  description: string;
  mitigation: string;
}

export interface SimulationResult {
  personas: SimulatedPersona[];
  risk_scenarios: RiskScenario[];
  market_reception_summary: string;
  investor_sentiment: string;
}

export interface WorkflowResult {
  gtm_strategy: {
    target_segments: string[];
    channels: { name: string; strategy: string; budget: string; priority: string }[];
    pricing: string;
    launch_plan: string;
    key_partnerships: string[];
  };
  pitch_deck: { slide: string; content: string }[];
  financial_model: {
    assumptions: string[];
    projections: { period: string; revenue: string; costs: string; profit: string }[];
    funding_needed: string;
  };
  roadmap: {
    milestone: string;
    timeline: string;
    deliverables: string[];
    status: string;
  }[];
  action_items: { task: string; priority: string; timeline: string; owner: string }[];
}

export interface ToolActivity {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  tools?: ToolActivity[];
}

export interface Task {
  task_id: string;
  task_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

// === Command Center ===
export interface MetricDefinition {
  metric_id: string;
  name: string;
  type: 'currency' | 'count' | 'percentage' | 'duration';
  target_growth_rate: number;
  entries: MetricEntry[];
}
export interface MetricEntry {
  date: string;
  value: number;
  notes: string;
}
export interface BurnRate {
  monthly_burn: number;
  cash_on_hand: number;
  last_updated: string;
}
export interface Alert {
  alert_id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  created_at: string;
  dismissed: boolean;
}
export interface DashboardData {
  metrics: MetricDefinition[];
  burn_rate: BurnRate | null;
  alerts: Alert[];
}
export interface HealthAnalysis {
  health_score: number;
  trajectory: string;
  top_concern: string;
  top_opportunity: string;
  weekly_advice: string;
}

// === Growth Intelligence ===
export interface GrowthLoop {
  loop_id: string;
  metric_name: string;
  optimization_target: string;
  status: 'active' | 'paused' | 'completed';
  baseline_value: number;
  current_best_value: number;
  iterations: GrowthIteration[];
  accumulated_learnings: string;
}
export interface GrowthIteration {
  iteration_id: string;
  created_at: string;
  hypothesis: string;
  proposed_changes: { element: string; current: string; proposed: string }[];
  status: 'proposed' | 'testing' | 'tested' | 'adopted' | 'rejected';
  result_value: number | null;
  improvement_pct: number | null;
  learnings: string;
  adopted: boolean;
}

// === Fundraising OS ===
export interface FundraisingRound {
  round_type: string;
  target_amount: number;
  valuation_cap: number;
  instrument: string;
  status: string;
  target_close: string;
}
export interface Investor {
  investor_id: string;
  name: string;
  type: string;
  contact_name: string;
  contact_email: string;
  stage: string;
  check_size: number;
  notes: string;
  interactions: InvestorInteraction[];
  tags: string[];
  created_at: string;
  updated_at: string;
}
export interface InvestorInteraction {
  date: string;
  type: string;
  summary: string;
  next_step: string;
  next_step_date: string;
}
export interface PitchVersion {
  version_id: string;
  version_number: number;
  created_at: string;
  slides: { slide: string; content: string; speaker_notes: string }[];
  feedback_summary: string;
  changelog: string[];
}
export interface TermSheet {
  term_sheet_id: string;
  investor_id: string;
  received_at: string;
  valuation: number;
  amount: number;
  instrument: string;
  key_terms: string;
  status: string;
  notes: string;
}
export interface FundraisingData {
  round: FundraisingRound | null;
  investors: Investor[];
  pitch_versions: PitchVersion[];
  term_sheets: TermSheet[];
}

// === Startup Journey ===
export interface StageInfo {
  current_stage: 'idea' | 'mvp' | 'pmf' | 'growth' | 'scale';
  started_at: string;
}
export interface Milestone {
  milestone_id: string;
  week: number;
  phase: string;
  title: string;
  description: string;
  status: 'upcoming' | 'in_progress' | 'completed' | 'skipped';
  completed_at: string | null;
  linked_feature: string | null;
}
export interface StartupUpdate {
  update_id: string;
  period: string;
  date: string;
  metrics_snapshot: Record<string, number>;
  highlights: string[];
  challenges: string[];
  asks: string[];
  morale: number;
  generated_summary: string;
}
export interface ScalingPlan {
  months: {
    month: number;
    focus: string;
    goals: string[];
    risks: string[];
    status: string;
  }[];
}
export interface JourneyData {
  stage_info: StageInfo | null;
  milestones: Milestone[];
  updates: StartupUpdate[];
  scaling_plan: ScalingPlan | null;
}

// === Ecosystem Intelligence (Layer 1 autonomous feed) ===
export type EcosystemAlertType =
  | 'competitor_activity'
  | 'ip_filing'
  | 'trend_signal'
  | 'partnership_opportunity'
  | 'regulatory_change'
  | 'funding_event';

export type EcosystemAlertState =
  | 'pending'
  | 'acknowledged'
  | 'dismissed'
  | 'promoted_to_action';

export interface EcosystemAlert {
  id: string;
  project_id: string;
  monitor_id: string | null;
  monitor_run_id: string | null;
  alert_type: EcosystemAlertType;
  source: string | null;
  source_url: string | null;
  headline: string;
  body: string | null;
  relevance_score: number;
  confidence: number;
  graph_node_id: string | null;
  reviewed_state: EcosystemAlertState;
  reviewed_at: string | null;
  founder_action_taken: string | null;
  dedupe_hash: string | null;
  created_at: string;
}

// === Pending Actions (approval inbox) ===
export type PendingActionType =
  | 'draft_email'
  | 'draft_linkedin_post'
  | 'draft_linkedin_dm'
  | 'proposed_hypothesis'
  | 'proposed_interview_question'
  | 'proposed_landing_copy'
  | 'proposed_investor_followup'
  | 'proposed_graph_update'
  | 'workflow_step'                 // chat-proposed workflow step, one row per step
  | 'configure_monitor'             // chat-proposed ecosystem monitor awaiting founder approval
  | 'configure_budget'              // chat-proposed monthly LLM budget cap change awaiting founder approval
  | 'skill_rerun_result'            // heartbeat-executor refreshed a stale analytical skill — surfaces new score in inbox
  | 'task';                         // chat-proposed founder task (TODO) — Mark done / Snooze / Dismiss

export type PendingActionStatus =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'sent'
  | 'failed';

export interface PendingAction {
  id: string;
  project_id: string;
  monitor_run_id: string | null;
  ecosystem_alert_id: string | null;
  action_type: PendingActionType;
  title: string;
  rationale: string | null;
  payload: Record<string, unknown>;
  estimated_impact: 'low' | 'medium' | 'high' | null;
  status: PendingActionStatus;
  edited_payload: Record<string, unknown> | null;
  execution_target: string | null;
  executed_at: string | null;
  execution_result: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Re-export lane taxonomy defined in src/lib/action-lanes.ts so UI code
// can `import type { ActionLane } from '@/types'` without reaching into lib.
// Phase 1 of the 4-bucket reorganization (Tasks / Approvals / Notifications).
// Source moved out of pending-actions.ts so client bundles don't pull in
// server-only DB code (Turbopack: "Module not found").
export type { ActionLane } from '@/lib/action-lanes';

// === Partner Configs (Add-on 1/3 onboarding) ===
export interface PartnerConfig {
  slug: string;
  display_name: string;
  locale: string;
  knowledge_seed: Record<string, unknown> | null;
  preferred_skills: string[] | null;
  brief_template: string;
  brand: Record<string, unknown> | null;
  created_at: string;
}

// === Project Budgets (cost governance) ===
export interface ProjectBudget {
  id: string;
  project_id: string;
  period_month: string;
  cap_llm_usd: number;
  cap_external_actions: number;
  warn_llm_usd: number;
  warn_external_actions: number;
  current_llm_usd: number;
  current_external_actions: number;
  status: 'active' | 'warned' | 'capped';
  created_at: string;
  updated_at: string;
}

// === Monday Brief (aggregated digest delivered by cron) ===
export interface MondayBriefSection {
  kind: 'movements' | 'actions_taken' | 'decisions_needed' | 'metrics' | 'fundraising';
  heading: string;
  narrative: string;
  artifacts?: Array<Record<string, unknown>>;
}

export interface MondayBrief {
  project_id: string;
  period_week_start: string;
  personality_intro: string;
  sections: MondayBriefSection[];
  ecosystem_alerts: EcosystemAlert[];
  pending_actions: PendingAction[];
  operational_alerts: Alert[];
  generated_at: string;
}
