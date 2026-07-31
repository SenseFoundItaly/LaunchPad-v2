/**
 * Map an open validation check's label to an actionable co-pilot prompt.
 * Keyword-matched (robust to check-id / label changes). Shared by the chat
 * empty-state briefing, the project-brief endpoint, and the clickable
 * SpineSection substeps — so "click an unmet substep → pre-fill chat" and the
 * briefing's next steps always phrase the ask the same way.
 *
 * Pure → depends only on the injected translate fn, so it's safe in both client
 * components (pass `useT()`) and server routes (pass `(k, v) => translate(locale, k, v)`).
 * The returned prompt is localized to the caller's locale; the keyword match runs
 * on the (always-English) check label, so category routing is locale-independent.
 */
import type { MessageKey, TranslateVars } from '@/lib/i18n/messages';
import type { Locale } from '@/lib/i18n/locales';

type TFn = (key: MessageKey, vars?: TranslateVars) => string;

export function checkActionPrompt(label: string, t: TFn): string {
  const l = label.toLowerCase();
  // Whole-canvas / scoring checks first — their labels would otherwise fall
  // through to the broader problem/solution/advantage matches below.
  if (/lean canvas/.test(l)) return t('journey-prompt.lean-canvas');
  if (/scoring|baseline/.test(l)) return t('journey-prompt.scoring');
  // `/dependenc/` before feasibility: "Key technical dependencies named" matches both.
  if (/dependenc/.test(l)) return t('journey-prompt.dependencies');
  if (/feasibilit|technical/.test(l)) return t('journey-prompt.feasibility');
  if (/regulat|complian|gdpr|licens/.test(l)) return t('journey-prompt.regulatory');
  if (/segment|icp|ideal customer|persona|beachhead/.test(l)) return t('journey-prompt.segment');
  if (/competitor/.test(l)) return t('journey-prompt.competitors');
  if (/interview/.test(l)) return t('journey-prompt.interviews');
  if (/watcher|monitor/.test(l)) return t('journey-prompt.watcher');
  if (/market size|\btam\b|\bsam\b|\bsom\b/.test(l)) return t('journey-prompt.market-size');
  if (/pain/.test(l)) return t('journey-prompt.pain-point');
  if (/channel|acquisition|reach|distribution/.test(l)) return t('journey-prompt.channels');
  // Before business-model: "Willingness-to-pay signal captured" (1C) is an
  // interview-evidence ask, not a pricing-design ask.
  if (/willingness|wtp/.test(l)) return t('journey-prompt.wtp');
  if (/business model|revenue|pricing|unit econ|tier|willingness|anchor price/.test(l)) return t('journey-prompt.business-model');
  if (/differentiat|competitive|edge|advantage/.test(l)) return t('journey-prompt.differentiation');
  if (/value prop/.test(l)) return t('journey-prompt.value-prop');
  if (/problem/.test(l)) return t('journey-prompt.problem');
  if (/solution/.test(l)) return t('journey-prompt.solution');
  if (/runway|burn/.test(l)) return t('journey-prompt.runway');
  if (/growth loop|growth/.test(l)) return t('journey-prompt.growth');
  if (/metric/.test(l)) return t('journey-prompt.metrics');
  if (/mvp|ship|launch|\bbuild\b/.test(l)) return t('journey-prompt.mvp');
  if (/capital|fundrais|round|investor/.test(l)) return t('journey-prompt.fundraise');
  if (/users/.test(l)) return t('journey-prompt.users');
  return t('journey-prompt.generic', { label });
}

/**
 * Founder-facing display labels for the spine (check rows + stage tiles +
 * taglines) are LOCALIZED here, keyed by the stable check/stage id.
 *
 * Why not translate at the source? The journey evaluators (src/lib/journey/*)
 * are shared server+client and their English `label` strings double as the
 * KEYWORD input to `checkActionPrompt` above (category routing runs on the
 * English label, locale-independent). So the English label stays the logical
 * source of truth; only the RENDERED text is swapped per-locale here, keyed by
 * id. An unmapped id (e.g. a newly added check) falls back to its English
 * label — never a raw key — so the spine degrades gracefully, English-only.
 *
 * The maps are exhaustive against the 7 canonical stages and their checks; the
 * paired i18n keys live in src/lib/i18n/messages/{en,it}.ts.
 */
const CHECK_LABEL_KEY: Record<string, MessageKey> = {
  // Stage 1 — Idea Canvas
  problem_defined: 'journey-check.problem_defined',
  solution_sketched: 'journey-check.solution_sketched',
  target_icp_defined: 'journey-check.target_icp_defined',
  value_prop: 'journey-check.value_prop',
  edge_articulated: 'journey-check.edge_articulated',
  channels_defined: 'journey-check.channels_defined',
  cost_revenue_defined: 'journey-check.cost_revenue_defined',
  lean_canvas_compiled: 'journey-check.lean_canvas_compiled',
  startup_scoring_baseline: 'journey-check.startup_scoring_baseline',
  // Stage 2 — Validation Gate (1A / 1B / 1C)
  competitors_mapped: 'journey-check.competitors_mapped',
  market_size: 'journey-check.market_size',
  differentiation_evidence: 'journey-check.differentiation_evidence',
  trends_assessed: 'journey-check.trends_assessed',
  buyer_persona_defined: 'journey-check.buyer_persona_defined',
  build_approach: 'journey-check.build_approach',
  technical_risk_named: 'journey-check.technical_risk_named',
  key_dependencies: 'journey-check.key_dependencies',
  regulatory_check: 'journey-check.regulatory_check',
  interviews_logged: 'journey-check.interviews_logged',
  pain_validated: 'journey-check.pain_validated',
  wtp_signal: 'journey-check.wtp_signal',
  // Stage 3 — Persona
  icp_defined: 'journey-check.icp_defined',
  channels_identified: 'journey-check.channels_identified',
  // Stage 4 — Business Model
  anchor_set: 'journey-check.anchor_set',
  tiers_defined: 'journey-check.tiers_defined',
  wtp_researched: 'journey-check.wtp_researched',
  model_chosen: 'journey-check.model_chosen',
  unit_econ_viable: 'journey-check.unit_econ_viable',
  // Stage 5 — Build & Launch
  workflow_active: 'journey-check.workflow_active',
  scope_defined: 'journey-check.scope_defined',
  something_shipped: 'journey-check.something_shipped',
  early_users: 'journey-check.early_users',
  // Stage 6 — Fundraise
  runway_clear: 'journey-check.runway_clear',
  capital_plan: 'journey-check.capital_plan',
  // Stage 7 — Operate
  loop_active: 'journey-check.loop_active',
  metrics_tracked: 'journey-check.metrics_tracked',
};

const STAGE_LABEL_KEY: Record<string, MessageKey> = {
  idea_validation: 'journey-stage.idea_validation',
  market_validation: 'journey-stage.market_validation',
  persona: 'journey-stage.persona',
  business_model: 'journey-stage.business_model',
  build_launch: 'journey-stage.build_launch',
  fundraise: 'journey-stage.fundraise',
  operate: 'journey-stage.operate',
};

const STAGE_TAGLINE_KEY: Record<string, MessageKey> = {
  idea_validation: 'journey-tagline.idea_validation',
  market_validation: 'journey-tagline.market_validation',
  persona: 'journey-tagline.persona',
  business_model: 'journey-tagline.business_model',
  build_launch: 'journey-tagline.build_launch',
  fundraise: 'journey-tagline.fundraise',
  operate: 'journey-tagline.operate',
};

/** Localized display label for a spine check row (falls back to the English
 *  label for any id without a mapping). */
export function checkLabel(id: string, fallback: string, t: TFn): string {
  const key = CHECK_LABEL_KEY[id];
  return key ? t(key) : fallback;
}

/** Localized display label for a stage tile / header. */
export function stageLabel(id: string, fallback: string, t: TFn): string {
  const key = STAGE_LABEL_KEY[id];
  return key ? t(key) : fallback;
}

/** Localized tagline for a stage (falls back to the English tagline). */
export function stageTagline(id: string, fallback: string | undefined, t: TFn): string | undefined {
  const key = STAGE_TAGLINE_KEY[id];
  return key ? t(key) : fallback;
}

/**
 * Founder-facing GAP hints (the "what's missing" sub-line under an unmet check)
 * are generated ENGLISH server-side in the journey evaluators — so they leaked
 * English on IT projects. Keyed by check id here for IT display; EN keeps the
 * evaluator's `result.gap` verbatim (preserving its runtime specifics — "2 of
 * 3", "8.5mo", "LTV:CAC = 0.7x"), while IT renders a clean localized hint. A
 * check with two gap branches (empty vs partial) collapses to one sensible IT
 * hint; the runtime count is only dropped on IT. An unmapped id falls back to
 * the English gap, never a raw key.
 */
const GAP_LABEL_KEY: Record<string, MessageKey> = {
  // Stage 1 — Idea Canvas
  problem_defined: 'journey-gap.problem_defined',
  solution_sketched: 'journey-gap.solution_sketched',
  target_icp_defined: 'journey-gap.target_icp_defined',
  value_prop: 'journey-gap.value_prop',
  edge_articulated: 'journey-gap.edge_articulated',
  channels_defined: 'journey-gap.channels_defined',
  cost_revenue_defined: 'journey-gap.cost_revenue_defined',
  lean_canvas_compiled: 'journey-gap.lean_canvas_compiled',
  startup_scoring_baseline: 'journey-gap.startup_scoring_baseline',
  // Stage 2 — Validation Gate
  competitors_mapped: 'journey-gap.competitors_mapped',
  market_size: 'journey-gap.market_size',
  differentiation_evidence: 'journey-gap.differentiation_evidence',
  trends_assessed: 'journey-gap.trends_assessed',
  buyer_persona_defined: 'journey-gap.buyer_persona_defined',
  build_approach: 'journey-gap.build_approach',
  technical_risk_named: 'journey-gap.technical_risk_named',
  key_dependencies: 'journey-gap.key_dependencies',
  regulatory_check: 'journey-gap.regulatory_check',
  interviews_logged: 'journey-gap.interviews_logged',
  pain_validated: 'journey-gap.pain_validated',
  wtp_signal: 'journey-gap.wtp_signal',
  // Stage 3 — Persona
  icp_defined: 'journey-gap.icp_defined',
  channels_identified: 'journey-gap.channels_identified',
  // Stage 4 — Business Model
  anchor_set: 'journey-gap.anchor_set',
  tiers_defined: 'journey-gap.tiers_defined',
  wtp_researched: 'journey-gap.wtp_researched',
  model_chosen: 'journey-gap.model_chosen',
  unit_econ_viable: 'journey-gap.unit_econ_viable',
  // Stage 5 — Build & Launch
  workflow_active: 'journey-gap.workflow_active',
  scope_defined: 'journey-gap.scope_defined',
  something_shipped: 'journey-gap.something_shipped',
  early_users: 'journey-gap.early_users',
  // Stage 6 — Fundraise
  runway_clear: 'journey-gap.runway_clear',
  capital_plan: 'journey-gap.capital_plan',
  // Stage 7 — Operate
  loop_active: 'journey-gap.loop_active',
  metrics_tracked: 'journey-gap.metrics_tracked',
};

/**
 * Localized gap hint for a spine check row. EN keeps the evaluator's verbatim
 * `gap` (its runtime specifics intact); non-EN locales get the localized hint
 * keyed by check id, falling back to the English gap for any unmapped id.
 */
export function checkGap(
  checkId: string,
  gap: string | undefined,
  t: TFn,
  locale: Locale,
): string | undefined {
  if (gap == null) return undefined;
  if (locale !== 'en') {
    const key = GAP_LABEL_KEY[checkId];
    if (key) return t(key);
  }
  return gap;
}

/**
 * Founder-facing EVIDENCE strings (the confirmation under a PASSED check) are
 * also generated English server-side. Same treatment as gaps: EN keeps the
 * evaluator's verbatim `result.evidence` (its runtime specifics — "3
 * competitors", "7.2/10" — intact), IT renders a localized confirmation keyed
 * by check id (multi-branch evidence collapses to one; runtime count dropped on
 * IT only). Unmapped id → the English evidence, never a raw key.
 */
const EVIDENCE_LABEL_KEY: Record<string, MessageKey> = {
  // Stage 1
  problem_defined: 'journey-evidence.problem_defined',
  solution_sketched: 'journey-evidence.solution_sketched',
  target_icp_defined: 'journey-evidence.target_icp_defined',
  value_prop: 'journey-evidence.value_prop',
  edge_articulated: 'journey-evidence.edge_articulated',
  channels_defined: 'journey-evidence.channels_defined',
  cost_revenue_defined: 'journey-evidence.cost_revenue_defined',
  lean_canvas_compiled: 'journey-evidence.lean_canvas_compiled',
  startup_scoring_baseline: 'journey-evidence.startup_scoring_baseline',
  // Stage 2
  competitors_mapped: 'journey-evidence.competitors_mapped',
  market_size: 'journey-evidence.market_size',
  differentiation_evidence: 'journey-evidence.differentiation_evidence',
  trends_assessed: 'journey-evidence.trends_assessed',
  buyer_persona_defined: 'journey-evidence.buyer_persona_defined',
  build_approach: 'journey-evidence.build_approach',
  technical_risk_named: 'journey-evidence.technical_risk_named',
  key_dependencies: 'journey-evidence.key_dependencies',
  regulatory_check: 'journey-evidence.regulatory_check',
  interviews_logged: 'journey-evidence.interviews_logged',
  pain_validated: 'journey-evidence.pain_validated',
  wtp_signal: 'journey-evidence.wtp_signal',
  // Stage 3
  icp_defined: 'journey-evidence.icp_defined',
  channels_identified: 'journey-evidence.channels_identified',
  // Stage 4
  anchor_set: 'journey-evidence.anchor_set',
  tiers_defined: 'journey-evidence.tiers_defined',
  wtp_researched: 'journey-evidence.wtp_researched',
  model_chosen: 'journey-evidence.model_chosen',
  unit_econ_viable: 'journey-evidence.unit_econ_viable',
  // Stage 5
  workflow_active: 'journey-evidence.workflow_active',
  scope_defined: 'journey-evidence.scope_defined',
  something_shipped: 'journey-evidence.something_shipped',
  early_users: 'journey-evidence.early_users',
  // Stage 6
  runway_clear: 'journey-evidence.runway_clear',
  capital_plan: 'journey-evidence.capital_plan',
  // Stage 7
  loop_active: 'journey-evidence.loop_active',
  metrics_tracked: 'journey-evidence.metrics_tracked',
};

/** Localized evidence string for a PASSED spine check. EN keeps the evaluator's
 *  verbatim evidence; non-EN gets the localized confirmation keyed by check id. */
export function checkEvidence(
  checkId: string,
  evidence: string | undefined,
  t: TFn,
  locale: Locale,
): string | undefined {
  if (evidence == null) return undefined;
  if (locale !== 'en') {
    const key = EVIDENCE_LABEL_KEY[checkId];
    if (key) return t(key);
  }
  return evidence;
}
