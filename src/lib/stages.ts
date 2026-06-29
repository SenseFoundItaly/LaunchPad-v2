import { canonicalStageLabel } from '@/lib/journey/canonical';

export interface SkillDef {
  id: string;
  label: string;
  route: string;
  dataKey: string;
}

/**
 * Founder-facing stage verdict — the closed union shared by the producer
 * (GET /api/projects/[id]/intelligence) and the consumer (SpineSection).
 * Maps 1:1 to scoring.ts verdict strings: STRONG GO / GO / CAUTION / NOT READY.
 */
export type StageVerdict = 'strong_go' | 'go' | 'caution' | 'not_ready';

const VERDICT_RANK: Record<StageVerdict, number> = {
  not_ready: 0,
  caution: 1,
  go: 2,
  strong_go: 3,
};

/**
 * Blend the skill-derived verdict with journey evidence so the Canvas spine
 * can never contradict the Home journey card (audit M2, "verdict schism":
 * /stages said Market Validation was done 8/8 while /intelligence rendered
 * the same stage NOT READY · 0.0/10 because it only counted skill runs).
 *
 * Rule (closed union — no new statuses):
 *   1. Evidence complete (passed === total, total > 0) → floor the verdict
 *      at 'go'. A stage with full validation evidence NEVER renders
 *      'not_ready' (or 'caution'), even with zero pipeline skills run.
 *      'strong_go' stays earned exclusively through skill scores.
 *   2. Partial evidence (passed/total ≥ 0.5) → upgrade 'not_ready' to
 *      'caution' — the closest existing union value to "in progress".
 *   3. Otherwise → the skill verdict stands unchanged.
 *
 * Readiness score and % complete stay skill-derived on purpose; the UI
 * renders "Evidence X/Y" alongside them so the numbers explain themselves.
 */
export function blendStageVerdict(
  skillVerdict: StageVerdict,
  evidencePassed: number,
  evidenceTotal: number,
): StageVerdict {
  if (evidenceTotal > 0 && evidencePassed >= evidenceTotal) {
    return VERDICT_RANK[skillVerdict] >= VERDICT_RANK.go ? skillVerdict : 'go';
  }
  if (evidenceTotal > 0 && evidencePassed / evidenceTotal >= 0.5 && skillVerdict === 'not_ready') {
    return 'caution';
  }
  return skillVerdict;
}

export interface StageDef {
  number: number;
  name: string;
  color: string;
  skills: SkillDef[];
}

// Pipeline skills only. `startup-advisor` (in launchpad-skills/) is a meta-skill
// invoked from chat for free-form guidance — deliberately outside the pipeline
// so it doesn't affect readiness scoring or next_recommended_skill.
//
// Stage names come from the canonical taxonomy (src/lib/journey/canonical.ts)
// so this engine and the journey gate checks can never show different labels
// for the same stage number. Skill ids / dataKeys are DB-referenced
// (skill_completions, section_scores) — never rename those here.
export const STAGES: StageDef[] = [
  {
    number: 1,
    name: canonicalStageLabel(1), // Idea Validation
    color: 'blue',
    skills: [
      { id: 'idea-shaping', label: 'Idea Canvas', route: 'chat?skill=idea-shaping', dataKey: 'idea_canvas' },
      { id: 'startup-scoring', label: 'Startup Score', route: 'chat?skill=startup-scoring', dataKey: 'scores' },
    ],
  },
  {
    number: 2,
    name: canonicalStageLabel(2), // Market Validation
    color: 'purple',
    skills: [
      { id: 'market-research', label: 'Market Research', route: 'chat?skill=market-research', dataKey: 'research' },
      // L2 Validation Gate · track 1B — technical feasibility / dependencies /
      // regulatory. Validates incrementally from chat (memory_facts) and closes
      // the 1B checks in stage-2-market-validation.ts.
      { id: 'technical-validation', label: 'Technical Validation', route: 'chat?skill=technical-validation', dataKey: 'technical_validation' },
      { id: 'simulation', label: 'Simulation', route: 'chat?skill=simulation', dataKey: 'simulation' },
    ],
  },
  {
    number: 3,
    name: canonicalStageLabel(3), // Persona (was "Persona Validation")
    color: 'rose',
    skills: [
      { id: 'scientific-validation', label: 'Buyer Personas', route: 'chat?skill=scientific-validation', dataKey: 'scientific_validation' },
      { id: 'risk-scoring', label: 'Risk Audit', route: 'chat?skill=risk-scoring', dataKey: 'risk_scoring' },
    ],
  },
  {
    number: 4,
    name: canonicalStageLabel(4), // Business Model
    color: 'amber',
    skills: [
      { id: 'business-model', label: 'Business Model', route: 'chat?skill=business-model', dataKey: 'business_model' },
      { id: 'financial-model', label: 'Financial Model', route: 'chat?skill=financial-model', dataKey: 'financial_model' },
    ],
  },
  {
    number: 5,
    name: canonicalStageLabel(5), // Build & Launch
    color: 'emerald',
    skills: [
      { id: 'prototype-spec', label: 'MVP Spec', route: 'chat?skill=prototype-spec', dataKey: 'prototype_spec' },
      { id: 'gtm-strategy', label: 'GTM Strategy', route: 'chat?skill=gtm-strategy', dataKey: 'gtm_strategy' },
      { id: 'growth-optimization', label: 'Growth Loops', route: 'chat?skill=growth-optimization', dataKey: 'growth_loops' },
      { id: 'build-landing-page', label: 'Landing Page', route: 'chat?skill=build-landing-page', dataKey: 'build_landing_page' },
      { id: 'build-pitch-deck', label: 'Pitch Deck', route: 'chat?skill=build-pitch-deck', dataKey: 'build_pitch_deck' },
      { id: 'build-one-pager', label: 'One-Pager', route: 'chat?skill=build-one-pager', dataKey: 'build_one_pager' },
    ],
  },
  {
    number: 6,
    name: canonicalStageLabel(6), // Fundraise
    color: 'cyan',
    skills: [
      { id: 'investment-readiness', label: 'Inv. Readiness', route: 'chat?skill=investment-readiness', dataKey: 'investment_readiness' },
      { id: 'pitch-coaching', label: 'Pitch Coaching', route: 'chat?skill=pitch-coaching', dataKey: 'pitch_versions' },
      { id: 'investor-relations', label: 'Pipeline', route: 'chat?skill=investor-relations', dataKey: 'investors' },
    ],
  },
  {
    number: 7,
    name: canonicalStageLabel(7), // Operate
    color: 'zinc',
    skills: [
      { id: 'weekly-metrics', label: 'Metrics', route: 'chat?skill=weekly-metrics', dataKey: 'metrics' },
    ],
  },
];

export const SKILL_KICKOFFS: Record<string, string> = {
  'idea-shaping': 'Help me structure my startup idea into a Lean Canvas. Walk me through each section.',
  'startup-scoring': 'Score my startup idea across all 6 dimensions and give me specific ratings.',
  'market-research': 'Run a comprehensive market analysis — TAM/SAM/SOM, competitors, and trends.',
  'scientific-validation': 'Generate detailed buyer personas and an empathy map for my startup.',
  'risk-scoring': 'Run a comprehensive risk audit across all dimensions — technical, market, regulatory, team, and financial.',
  'business-model': 'Help me evaluate and score business model options for my startup.',
  'financial-model': 'Build detailed 3-year financial projections with scenario analysis for my startup.',
  'prototype-spec': 'Create an MVP blueprint — tech stack, core features, brand identity, and build timeline.',
  'gtm-strategy': 'Develop a go-to-market strategy — target segments, channels, pricing, and launch plan.',
  'growth-optimization': 'Set up growth experiment loops to improve my key metrics.',
  'investment-readiness': 'Assess my fundraising readiness — OKRs, deck, data room, and gaps to close.',
  'pitch-coaching': 'Help me prepare my investor pitch — narrative arc, key slides, and objection handling.',
  'investor-relations': 'Help me build my investor pipeline and plan outreach strategy.',
  'simulation': 'Simulate market reception for my startup — run 6 persona reactions (2 customers, 2 investors, 1 expert, 1 competitor) and 4 risk scenarios.',
  'weekly-metrics': 'Analyze my startup metrics, calculate burn rate and runway, and flag any alerts or trends I should watch.',
  'build-landing-page': 'Build me a responsive landing page based on my validated idea, market research, and brand positioning.',
  'build-pitch-deck': 'Build a Sequoia-format investor pitch deck using my validated project data.',
  'build-one-pager': 'Create a concise executive summary one-pager for investor outreach.',
};

/** Contextual next steps shown in the skill detail panel after completion */
export const SKILL_NEXT_STEPS: Record<string, { label: string; skillId: string }[]> = {
  'idea-shaping': [
    { label: 'Score this idea across 6 dimensions', skillId: 'startup-scoring' },
    { label: 'Research the market size and competitors', skillId: 'market-research' },
  ],
  'startup-scoring': [
    { label: 'Deep-dive into market validation', skillId: 'market-research' },
    { label: 'Audit risks before committing', skillId: 'risk-scoring' },
    { label: 'Generate buyer personas', skillId: 'scientific-validation' },
  ],
  'market-research': [
    { label: 'Simulate market reception with personas', skillId: 'simulation' },
    { label: 'Score business model options', skillId: 'business-model' },
  ],
  'simulation': [
    { label: 'Run a full risk audit', skillId: 'risk-scoring' },
    { label: 'Define your business model', skillId: 'business-model' },
  ],
  'scientific-validation': [
    { label: 'Score business model fit', skillId: 'business-model' },
    { label: 'Create MVP blueprint', skillId: 'prototype-spec' },
  ],
  'risk-scoring': [
    { label: 'Build financial projections', skillId: 'financial-model' },
    { label: 'Prepare investment readiness', skillId: 'investment-readiness' },
  ],
  'business-model': [
    { label: 'Build 3-year financial model', skillId: 'financial-model' },
    { label: 'Create MVP blueprint', skillId: 'prototype-spec' },
  ],
  'financial-model': [
    { label: 'Assess investment readiness', skillId: 'investment-readiness' },
    { label: 'Prepare investor pitch', skillId: 'pitch-coaching' },
    { label: 'Plan go-to-market strategy', skillId: 'gtm-strategy' },
  ],
  'prototype-spec': [
    { label: 'Plan go-to-market launch', skillId: 'gtm-strategy' },
    { label: 'Set up growth loops', skillId: 'growth-optimization' },
    { label: 'Build a landing page', skillId: 'build-landing-page' },
  ],
  'gtm-strategy': [
    { label: 'Set up growth experiment loops', skillId: 'growth-optimization' },
    { label: 'Build investor pipeline', skillId: 'investor-relations' },
    { label: 'Build a landing page', skillId: 'build-landing-page' },
  ],
  'build-landing-page': [
    { label: 'Set up growth experiment loops', skillId: 'growth-optimization' },
    { label: 'Build a pitch deck', skillId: 'build-pitch-deck' },
  ],
  'build-pitch-deck': [
    { label: 'Create executive one-pager', skillId: 'build-one-pager' },
    { label: 'Build investor pipeline', skillId: 'investor-relations' },
  ],
  'build-one-pager': [
    { label: 'Build investor pipeline', skillId: 'investor-relations' },
    { label: 'Practice investor pitch', skillId: 'pitch-coaching' },
  ],
  'growth-optimization': [
    { label: 'Track weekly metrics', skillId: 'weekly-metrics' },
    { label: 'Prepare for fundraising', skillId: 'investment-readiness' },
  ],
  'investment-readiness': [
    { label: 'Practice investor pitch', skillId: 'pitch-coaching' },
    { label: 'Build investor pipeline', skillId: 'investor-relations' },
  ],
  'pitch-coaching': [
    { label: 'Build target investor list', skillId: 'investor-relations' },
  ],
  'investor-relations': [
    { label: 'Track weekly metrics', skillId: 'weekly-metrics' },
  ],
};

/** Which skills feed into each skill */
export const SKILL_SOURCES: Record<string, string[]> = {
  'startup-scoring': ['idea-shaping'],
  'market-research': ['idea-shaping', 'startup-scoring'],
  'simulation': ['market-research', 'scientific-validation'],
  'scientific-validation': ['idea-shaping', 'startup-scoring'],
  'risk-scoring': ['startup-scoring', 'market-research'],
  'business-model': ['startup-scoring', 'market-research', 'scientific-validation'],
  'financial-model': ['business-model', 'startup-scoring'],
  'prototype-spec': ['idea-shaping', 'business-model'],
  'gtm-strategy': ['market-research', 'scientific-validation', 'business-model'],
  'growth-optimization': ['gtm-strategy', 'weekly-metrics'],
  'investment-readiness': ['financial-model', 'startup-scoring', 'risk-scoring'],
  'pitch-coaching': ['investment-readiness', 'financial-model'],
  'investor-relations': ['pitch-coaching', 'investment-readiness'],
  'build-landing-page': ['idea-shaping', 'market-research', 'prototype-spec'],
  'build-pitch-deck': ['idea-shaping', 'market-research', 'financial-model', 'business-model'],
  'build-one-pager': ['idea-shaping', 'market-research', 'startup-scoring'],
};

/** Color utility for Tailwind classes */
export function stageColors(color: string) {
  const map: Record<string, { text: string; bg: string; border: string; dot: string }> = {
    blue:    { text: 'text-sky',       bg: 'bg-sky/10',       border: 'border-sky/30',       dot: 'bg-sky' },
    purple:  { text: 'text-plum',      bg: 'bg-plum/10',      border: 'border-plum/30',      dot: 'bg-plum' },
    rose:    { text: 'text-cat-rose',  bg: 'bg-cat-rose/10',  border: 'border-cat-rose/30',  dot: 'bg-cat-rose' },
    amber:   { text: 'text-accent',    bg: 'bg-accent/10',    border: 'border-accent/30',    dot: 'bg-accent' },
    emerald: { text: 'text-moss',      bg: 'bg-moss/10',      border: 'border-moss/30',      dot: 'bg-moss' },
    cyan:    { text: 'text-cat-teal',  bg: 'bg-cat-teal/10',  border: 'border-cat-teal/30',  dot: 'bg-cat-teal' },
    zinc:    { text: 'text-ink-4',     bg: 'bg-ink-5/10',     border: 'border-ink-5/30',     dot: 'bg-ink-4' },
  };
  return map[color] || map.zinc;
}
