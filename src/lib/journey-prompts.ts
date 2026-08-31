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
  // BEFORE the baseline rule: 1C's scoring step asks for a RE-score against the
  // interview evidence. Routed to the baseline prompt it sent the founder to
  // re-run the thing they had already done.
  if (/scoring review|scoring reviewed|re-score/.test(l)) return t('journey-prompt.scoring-review');
  if (/scoring|baseline/.test(l)) return t('journey-prompt.scoring');
  // The gate's own decision — before /go/-adjacent matches below.
  if (/pivot|stop decision|verdict/.test(l)) return t('journey-prompt.gate-verdict');
  // 1C framing steps. Both are multi-word so they can't collide with the
  // broader /solution/ and /problem/ fallbacks at the end of the chain.
  if (/validation strategy/.test(l)) return t('journey-prompt.validation-strategy');
  if (/jobs-to-be-done|jobs to be done|\bjtbd\b/.test(l)) return t('journey-prompt.jtbd');
  // 1C interview PIPELINE (#398), high in the chain on purpose:
  //   - "contacted"/"outreach" would be stolen by /reach/ in the channels rule
  //   - both labels end in "users", which the Stage-5 /users/ fallback claimed,
  //     sending a founder listing interviewees to an acquire-early-users prompt
  if (/cold user(s)? listed|prospects listed/.test(l)) return t('journey-prompt.cold-users-listed');
  if (/cold user(s)? contacted|outreach/.test(l)) return t('journey-prompt.cold-users-outreach');
  // 1B. Word-boundary \bip\b deliberately — a bare 'ip' matches "description",
  // "equipment", "shipping".
  if (/patent|trademark|freedom to operate|intellectual property|\bip\b/.test(l)) return t('journey-prompt.ip');
  // Phrases, never a bare 'data' — that would swallow half the spine.
  if (/data availability|data quality|dataset|data access/.test(l)) return t('journey-prompt.data-availability');
  // `/dependenc/` before feasibility: "Key technical dependencies named" matches both.
  if (/dependenc/.test(l)) return t('journey-prompt.dependencies');
  // BEFORE feasibility (a future "Technical build approach" belongs here) and,
  // critically, before the Stage-5 /\bbuild\b/ MVP rule far below — which is
  // where "Build approach sketched (architecture / stack)" was landing. The
  // single check that blocks 1C on 116/116 prod projects was pre-filling
  // "help me scope and ship my MVP". Phrase-matched, never a bare `build`, so
  // the Stage-5 build checks keep the MVP prompt.
  if (/build approach|architecture|tech stack/.test(l)) return t('journey-prompt.build-approach');
  if (/feasibilit|technical/.test(l)) return t('journey-prompt.feasibility');
  if (/regulat|complian|gdpr|licens/.test(l)) return t('journey-prompt.regulatory');
  if (/segment|icp|ideal customer|persona|beachhead/.test(l)) return t('journey-prompt.segment');
  if (/competitor/.test(l)) return t('journey-prompt.competitors');
  if (/interview/.test(l)) return t('journey-prompt.interviews');
  if (/watcher|monitor/.test(l)) return t('journey-prompt.watcher');
  if (/market size|\btam\b|\bsam\b|\bsom\b/.test(l)) return t('journey-prompt.market-size');
  if (/pain/.test(l)) return t('journey-prompt.pain-point');
  // 1A distribution steps, BEFORE the channels rule: "channel partner" and
  // "distributor" would otherwise be read as an acquisition-channel ask.
  if (/partner|reseller|distributor|alliance/.test(l)) return t('journey-prompt.partners');
  if (/\bgtm\b|go-to-market|go to market|route to market/.test(l)) return t('journey-prompt.gtm');
  if (/channel|acquisition|reach|distribution/.test(l)) return t('journey-prompt.channels');
  // Before business-model: "Willingness-to-pay signal captured" (1C) is an
  // interview-evidence ask, not a pricing-design ask.
  if (/willingness|wtp/.test(l)) return t('journey-prompt.wtp');
  // Stage 4 cost/projection steps, BEFORE business-model: both are money asks,
  // but "estimate your COGS" is a different conversation from "design pricing".
  if (/cogs|opex|operating cost|cost structure/.test(l)) return t('journey-prompt.cogs-opex');
  if (/financial draft|financial model|projection|scenario/.test(l)) return t('journey-prompt.financial-draft');
  if (/business model|revenue|pricing|unit econ|tier|willingness|anchor price/.test(l)) return t('journey-prompt.business-model');
  if (/differentiat|competitive|edge|advantage/.test(l)) return t('journey-prompt.differentiation');
  if (/value prop/.test(l)) return t('journey-prompt.value-prop');
  if (/problem/.test(l)) return t('journey-prompt.problem');
  if (/solution/.test(l)) return t('journey-prompt.solution');
  if (/runway|burn/.test(l)) return t('journey-prompt.runway');
  if (/growth loop|growth/.test(l)) return t('journey-prompt.growth');
  if (/metric/.test(l)) return t('journey-prompt.metrics');
  // Before the MVP rule: "Workflow active" is about starting the build loop,
  // not about scoping what to build.
  if (/workflow/.test(l)) return t('journey-prompt.workflow');
  if (/mvp|ship|launch|\bbuild\b/.test(l)) return t('journey-prompt.mvp');
  if (/capital|fundrais|round|investor/.test(l)) return t('journey-prompt.fundraise');
  if (/users/.test(l)) return t('journey-prompt.users');
  return t('journey-prompt.generic', { label });
}

/**
 * Checks whose evidence a SKILL can produce, and which one.
 *
 * `build_approach` is green on 1 of 116 prod projects and it locks 1C on all of
 * them. Its gap text says "run Technical Validation" — and until now nothing in
 * the product could run it: skills reach a founder only when the co-pilot
 * happens to offer one as a card, and `technical-validation` has never been run
 * on any project, ever.
 *
 * So the row that names a skill now offers it. Explicit click, never automatic
 * — auto-running is the "troppo veicolato" the founder objected to in the 04/08
 * changelog, and the same reason nothing is seeded on project create.
 *
 * Deliberately a one-entry map, not a convention: `build_approach` is the only
 * check whose gap names a runnable skill (measured across all 7 stages, both
 * locales). It is a map so the next one is a line, not a refactor.
 */
const CHECK_RUNNABLE_SKILL: Record<string, string> = {
  build_approach: 'technical-validation',
};

/** The skill that can produce this check's evidence, if any. */
export function checkRunnableSkill(checkId: string): string | undefined {
  return CHECK_RUNNABLE_SKILL[checkId];
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
  gtm_opportunities: 'journey-check.gtm_opportunities',
  partners_identified: 'journey-check.partners_identified',
  monitors_set: 'journey-check.monitors_set',
  ip_analysis: 'journey-check.ip_analysis',
  data_availability: 'journey-check.data_availability',
  validation_strategy: 'journey-check.validation_strategy',
  jtbd_mapping: 'journey-check.jtbd_mapping',
  gate_verdict: 'journey-check.gate_verdict',
  build_approach: 'journey-check.build_approach',
  technical_risk_named: 'journey-check.technical_risk_named',
  key_dependencies: 'journey-check.key_dependencies',
  regulatory_check: 'journey-check.regulatory_check',
  cold_users_listed: 'journey-check.cold_users_listed',
  cold_users_outreach: 'journey-check.cold_users_outreach',
  interviews_logged: 'journey-check.interviews_logged',
  pain_validated: 'journey-check.pain_validated',
  wtp_signal: 'journey-check.wtp_signal',
  solution_in_depth: 'journey-check.solution_in_depth',
  value_prop_sharpened: 'journey-check.value_prop_sharpened',
  scoring_review: 'journey-check.scoring_review',
  // Stage 3 — Persona
  icp_defined: 'journey-check.icp_defined',
  channels_identified: 'journey-check.channels_identified',
  // Stage 4 — Business Model
  anchor_set: 'journey-check.anchor_set',
  tiers_defined: 'journey-check.tiers_defined',
  wtp_researched: 'journey-check.wtp_researched',
  model_chosen: 'journey-check.model_chosen',
  revenue_streams_defined: 'journey-check.revenue_streams_defined',
  cogs_opex_defined: 'journey-check.cogs_opex_defined',
  financial_draft_defined: 'journey-check.financial_draft_defined',
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
  // Planned (display-only roadmap items — see Stage.planned in journey/types.ts)
  planned_persona_interviews: 'journey-check.planned_persona_interviews',
  planned_wtp_signal: 'journey-check.planned_wtp_signal',
  planned_channel_test: 'journey-check.planned_channel_test',
  planned_launch_page: 'journey-check.planned_launch_page',
  planned_feedback_loop: 'journey-check.planned_feedback_loop',
  planned_pitch_deck: 'journey-check.planned_pitch_deck',
  planned_investor_pipeline: 'journey-check.planned_investor_pipeline',
  planned_data_room: 'journey-check.planned_data_room',
  planned_retention_baseline: 'journey-check.planned_retention_baseline',
  planned_unit_economics: 'journey-check.planned_unit_economics',
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
  gtm_opportunities: 'journey-gap.gtm_opportunities',
  partners_identified: 'journey-gap.partners_identified',
  monitors_set: 'journey-gap.monitors_set',
  ip_analysis: 'journey-gap.ip_analysis',
  data_availability: 'journey-gap.data_availability',
  validation_strategy: 'journey-gap.validation_strategy',
  jtbd_mapping: 'journey-gap.jtbd_mapping',
  gate_verdict: 'journey-gap.gate_verdict',
  build_approach: 'journey-gap.build_approach',
  technical_risk_named: 'journey-gap.technical_risk_named',
  key_dependencies: 'journey-gap.key_dependencies',
  regulatory_check: 'journey-gap.regulatory_check',
  cold_users_listed: 'journey-gap.cold_users_listed',
  cold_users_outreach: 'journey-gap.cold_users_outreach',
  interviews_logged: 'journey-gap.interviews_logged',
  pain_validated: 'journey-gap.pain_validated',
  wtp_signal: 'journey-gap.wtp_signal',
  solution_in_depth: 'journey-gap.solution_in_depth',
  value_prop_sharpened: 'journey-gap.value_prop_sharpened',
  scoring_review: 'journey-gap.scoring_review',
  // Stage 3 — Persona
  icp_defined: 'journey-gap.icp_defined',
  channels_identified: 'journey-gap.channels_identified',
  // Stage 4 — Business Model
  anchor_set: 'journey-gap.anchor_set',
  tiers_defined: 'journey-gap.tiers_defined',
  wtp_researched: 'journey-gap.wtp_researched',
  model_chosen: 'journey-gap.model_chosen',
  revenue_streams_defined: 'journey-gap.revenue_streams_defined',
  cogs_opex_defined: 'journey-gap.cogs_opex_defined',
  financial_draft_defined: 'journey-gap.financial_draft_defined',
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
 * Progress prefix the evaluators emit at the start of a counted gap/evidence
 * string ("2 of 3 — ask Co-pilot to research more", "4 of 5 — tell the
 * Co-pilot…"). Digits and "/" read the same in EN and IT, so carrying the
 * prefix across needs no new message keys.
 */
const PROGRESS_RE = /^(\d+)\s+of\s+(\d+)\b/;

/** Keep the evaluator's count in front of a localized sentence. */
function withProgress(runtime: string, localized: string): string {
  const m = runtime.trim().match(PROGRESS_RE);
  return m ? `${m[1]}/${m[2]} · ${localized}` : localized;
}

/**
 * Localized gap hint for a spine check row. EN keeps the evaluator's verbatim
 * `gap` (its runtime specifics intact); non-EN locales get the localized hint
 * keyed by check id, falling back to the English gap for any unmapped id.
 *
 * ⚠️ The localized hint is STATIC, so it used to DELETE the evaluator's count:
 * an Italian founder with 4 of 5 interviews logged read exactly the sentence he
 * read at zero ("Registra almeno 5 interviste") and could not tell whether he
 * was one interview away or five (2026-08-09 audit). The count now rides along
 * as a locale-neutral prefix. The real fix is structured counts on CheckResult
 * rather than parsing prose — this keeps the number honest until then, and
 * degrades to the plain sentence when there is no count to carry.
 */
/**
 * A few checks emit SEVERAL distinct gap states that must not collapse into one
 * localized sentence. gate_verdict is the load-bearing case: it says one of
 * "you called PIVOT on track 1A", "you called PIVOT", "you called STOP", or
 * "you haven't decided" — and IT rendered all four as "Prendi la decisione", so
 * a founder who had recorded STOP saw the row of a founder who had decided
 * nothing, with no trace of his own decision and no hint how to resume.
 * Resolved off the English gap, which this repo generates itself (the verdict
 * words are literal tokens we emit, not model prose).
 */
function gapKeyFor(checkId: string, gap: string): MessageKey | undefined {
  if (checkId === 'gate_verdict') {
    // Anchor on "You called …": the UNDECIDED sentence also contains the words
    // PIVOT and STOP ("record GO, PIVOT or STOP"), so a bare word test read
    // "you haven't decided" as "you chose STOP".
    if (/^You called STOP\b/.test(gap)) return 'journey-gap.gate_verdict-stop';
    if (/^You called PIVOT\b/.test(gap)) {
      return /\btrack\s+\S+/.test(gap)
        ? 'journey-gap.gate_verdict-pivot-scope'
        : 'journey-gap.gate_verdict-pivot';
    }
  }
  return GAP_LABEL_KEY[checkId];
}

export function checkGap(
  checkId: string,
  gap: string | undefined,
  t: TFn,
  locale: Locale,
): string | undefined {
  if (gap == null) return undefined;
  if (locale !== 'en') {
    const key = gapKeyFor(checkId, gap);
    if (key) {
      const scope = gap.match(/\btrack\s+(\S+)/)?.[1];
      return withProgress(gap, t(key, scope ? { scope } : undefined));
    }
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
  gtm_opportunities: 'journey-evidence.gtm_opportunities',
  partners_identified: 'journey-evidence.partners_identified',
  monitors_set: 'journey-evidence.monitors_set',
  ip_analysis: 'journey-evidence.ip_analysis',
  data_availability: 'journey-evidence.data_availability',
  validation_strategy: 'journey-evidence.validation_strategy',
  jtbd_mapping: 'journey-evidence.jtbd_mapping',
  gate_verdict: 'journey-evidence.gate_verdict',
  build_approach: 'journey-evidence.build_approach',
  technical_risk_named: 'journey-evidence.technical_risk_named',
  key_dependencies: 'journey-evidence.key_dependencies',
  regulatory_check: 'journey-evidence.regulatory_check',
  cold_users_listed: 'journey-evidence.cold_users_listed',
  cold_users_outreach: 'journey-evidence.cold_users_outreach',
  interviews_logged: 'journey-evidence.interviews_logged',
  pain_validated: 'journey-evidence.pain_validated',
  wtp_signal: 'journey-evidence.wtp_signal',
  solution_in_depth: 'journey-evidence.solution_in_depth',
  value_prop_sharpened: 'journey-evidence.value_prop_sharpened',
  scoring_review: 'journey-evidence.scoring_review',
  // Stage 3
  icp_defined: 'journey-evidence.icp_defined',
  channels_identified: 'journey-evidence.channels_identified',
  // Stage 4
  anchor_set: 'journey-evidence.anchor_set',
  tiers_defined: 'journey-evidence.tiers_defined',
  wtp_researched: 'journey-evidence.wtp_researched',
  model_chosen: 'journey-evidence.model_chosen',
  revenue_streams_defined: 'journey-evidence.revenue_streams_defined',
  cogs_opex_defined: 'journey-evidence.cogs_opex_defined',
  financial_draft_defined: 'journey-evidence.financial_draft_defined',
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
 *  verbatim evidence; non-EN gets the localized confirmation keyed by check id.
 *
 *  `stated` marks a check that is green off unclassified chat text rather than
 *  an approved evidence item. The sentence says so rather than claiming an
 *  approval the founder never gave: on prod 2026-08-14 one founder's gate read
 *  "Regulatory & compliance deep dive ✓" because a July answer about who feels
 *  the pain contained the words "rischi di compliance". Revoking those greens
 *  would un-do real work, so the check still passes — it just stops overstating
 *  why. */
export function checkEvidence(
  checkId: string,
  evidence: string | undefined,
  t: TFn,
  locale: Locale,
  stated?: boolean,
): string | undefined {
  if (evidence == null) return undefined;
  let out = evidence;
  if (locale !== 'en') {
    const key = EVIDENCE_LABEL_KEY[checkId];
    if (key) out = withProgress(evidence, t(key));
  }
  return stated ? `${out} ${t('journey-evidence.stated-suffix')}` : out;
}
