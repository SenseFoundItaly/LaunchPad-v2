/**
 * Content mapping: founder-message topic → registered skill tool.
 *
 * Single source of truth used by:
 *   1. The chat agent prompt (rendered into TIER 0.5 instructions via
 *      `renderContentMappingForPrompt`).
 *   2. The e2e-agent-flow.mjs scorer (`skill_first` dim — detect violations).
 *   3. The runtime violation check (`analyzeTurnViolations` in route.ts).
 *
 * Adding a skill: append an entry here. Prompt re-renders on next deploy;
 * the scorer + runtime check pick it up on next run.
 *
 * Iteration-3 extraction (was inline at route.ts:130-138 in the
 * ARTIFACT_INSTRUCTIONS template literal). See design doc
 * `mikececconello-launchpad-v2-project-design-20260607-222823.md` WS-R.0.
 */

export interface ContentMappingEntry {
  /** The skill id WITHOUT the `skill_` prefix, hyphen-normalized
   *  (matches `skill_completions.skill_id`). */
  skill_id: string;
  /** Founder-facing topic label, rendered into the prompt verbatim. */
  topic: string;
  /** Lowercased substrings — if any is found in the founder's last message,
   *  the topic counts as matched. Triggers, not regex — substring match keeps
   *  the scorer cheap. */
  triggers: string[];
}

export const CONTENT_MAPPING: ContentMappingEntry[] = [
  {
    skill_id: 'business-model',
    topic: 'Pricing, unit economics, willingness-to-pay, LTV/CAC, margins',
    triggers: ['pricing', 'unit economics', 'willingness to pay', 'ltv', 'cac', 'margin'],
  },
  {
    skill_id: 'market-research',
    topic: 'TAM/SAM/SOM, market sizing, competitors map, segments',
    triggers: ['tam', 'sam', 'som', 'market siz', 'competitor', 'segment'],
  },
  {
    skill_id: 'scientific-validation',
    topic: 'Personas, ICP, buyer profile, interview targets',
    triggers: ['persona', 'icp', 'buyer profile', 'interview target'],
  },
  {
    skill_id: 'risk-scoring',
    topic: 'Risks, fatal flaws, what could kill this',
    triggers: ['risk', 'fatal flaw', 'what could kill', 'what kills'],
  },
  {
    skill_id: 'gtm-strategy',
    topic: 'GTM, channels, launch plan, distribution',
    triggers: ['gtm', 'go to market', 'go-to-market', 'channel', 'launch plan', 'distribution'],
  },
  {
    skill_id: 'investment-readiness',
    topic: 'Pitch deck, fundraising readiness, investor materials',
    triggers: ['pitch deck', 'fundrais', 'investor', 'seed round', 'series a', 'series b'],
  },
  {
    skill_id: 'weekly-metrics',
    topic: 'Weekly metrics, churn, KPIs, growth health',
    triggers: ['weekly metric', 'churn', 'kpi', 'growth health'],
  },
  {
    skill_id: 'idea-shaping',
    topic: 'Lean Canvas, structure my idea, problem-solution fit',
    triggers: ['lean canvas', 'structure my idea', 'problem-solution', 'problem solution fit', 'shape my idea'],
  },
  {
    skill_id: 'financial-model',
    topic: 'Financial projections, runway, burn',
    triggers: ['financial projection', 'runway', 'burn rate', 'cash flow'],
  },
];

/** Render the mapping as the prompt-facing bullet list. Output shape matches
 *  the original inline content at route.ts:130-138, with skill ids
 *  underscore-normalized for the tool-name format. */
export function renderContentMappingForPrompt(): string {
  return CONTENT_MAPPING.map(
    (e) => `- ${e.topic} → skill_${e.skill_id.replace(/-/g, '_')}`,
  ).join('\n');
}

/** Test whether a founder message matches any content-mapping entry.
 *  Returns the FIRST matching entry (or null) to avoid ambiguity in the
 *  scorer + runtime check. Match is case-insensitive substring. */
export function findMatchingSkill(message: string): ContentMappingEntry | null {
  const lower = message.toLowerCase();
  for (const entry of CONTENT_MAPPING) {
    if (entry.triggers.some((t) => lower.includes(t))) {
      return entry;
    }
  }
  return null;
}
