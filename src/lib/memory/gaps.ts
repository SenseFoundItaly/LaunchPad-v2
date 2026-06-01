/**
 * Knowledge gaps — the "what's missing" surface, computed live from existing
 * tables on every call. Inspired by gbrain's brain-first lookup pattern: an
 * agent that can name its own holes is more credible than one that pretends
 * to know everything.
 *
 * Output is consumed in two places:
 *   1. `get_project_summary` appends `formatGapsForPrompt(gaps)` to the
 *      system context so the chat agent says "I don't have X — want me to
 *      run the skill that fills it?" rather than fabricating.
 *   2. `/api/projects/{p}/overview` returns the same `KnowledgeGap[]` so
 *      the Knowledge page can render them as actionable amber panels.
 *
 * No persistence — gaps are derived. They vanish automatically the moment
 * the underlying data appears, so there's no "dismissed gaps" table to
 * keep in sync.
 */
import { SKILL_KICKOFFS } from '@/lib/stages';
import type { ProjectReadiness } from '@/lib/stage-readiness';

export type GapKind =
  | 'no_idea_canvas'
  | 'no_market_research'
  | 'no_competitors'
  | 'no_personas'
  | 'no_risks'
  | 'no_pricing'
  | 'no_facts'
  | 'stale_skill'
  | 'next_skill';

export interface KnowledgeGap {
  /** Stable id — used as React key + future "dismiss this gap" handle. */
  id: string;
  kind: GapKind;
  /** Short label rendered in the UI chip / agent line. */
  label: string;
  /** One-sentence "why this matters" — drives the agent's framing and
   *  the UI tooltip. */
  why: string;
  /** Skill id to run to fill the gap. Null when the gap is conversational
   *  (e.g. "tell me what you already know") and no single skill covers it. */
  fill_skill: string | null;
  /** Drop-in kickoff prompt for the chat. Prefer the skill's own kickoff
   *  text from SKILL_KICKOFFS when fill_skill is set. */
  fill_kickoff: string;
  /** Stage number (1-7) this gap relates to, or null if cross-stage. */
  stage_number: number | null;
  /** Severity 0-5 — lower = more urgent. Used to cap to top N in the UI. */
  severity: number;
}

export interface GapInputs {
  idea: {
    problem: string | null;
    solution: string | null;
    target_market: string | null;
    business_model: string | null;
    value_proposition: string | null;
  } | null;
  research: {
    market_size: unknown;
    trends: unknown;
    key_insights: unknown;
  } | null;
  competitorsCount: number;
  /** graph_nodes (applied) — used to detect persona / risk presence. */
  entities: Array<{ node_type: string }>;
  /** simulation.risk_scenarios — if null/empty, we have no risk audit. */
  hasRiskAudit: boolean;
  factsCount: number;
  /** Stage readiness; if null we skip skill-driven gaps. */
  readiness: ProjectReadiness | null;
  /** Project creation timestamp — gates the "no facts yet" gap so brand-new
   *  projects don't see a "you should know things by now" line on day 0. */
  projectCreatedAt: string | null;
}

function ideaIsEmpty(idea: GapInputs['idea']): boolean {
  if (!idea) return true;
  return !idea.problem && !idea.solution && !idea.target_market && !idea.value_proposition;
}

function researchIsEmpty(research: GapInputs['research']): boolean {
  if (!research) return true;
  const hasSize = !!research.market_size;
  const hasTrends = Array.isArray(research.trends) && research.trends.length > 0;
  const hasInsights = Array.isArray(research.key_insights) && research.key_insights.length > 0;
  return !hasSize && !hasTrends && !hasInsights;
}

function kickoffFor(skillId: string, fallback: string): string {
  return SKILL_KICKOFFS[skillId] ?? fallback;
}

/**
 * Compute the gap list. Pure — no I/O. Caller is responsible for fetching
 * the inputs (overview/route.ts already loads everything in parallel).
 */
export function computeGaps(inputs: GapInputs): KnowledgeGap[] {
  const out: KnowledgeGap[] = [];

  // ── 1. No idea canvas (P0) ──────────────────────────────────────────
  if (ideaIsEmpty(inputs.idea)) {
    out.push({
      id: 'no_idea_canvas',
      kind: 'no_idea_canvas',
      label: 'Idea Canvas is empty',
      why: 'Without a problem, solution, and target market, every other skill is guessing.',
      fill_skill: 'idea-shaping',
      fill_kickoff: kickoffFor('idea-shaping', 'Help me shape my idea.'),
      stage_number: 1,
      severity: 0,
    });
  }

  // ── 2. Next-recommended skill (P1) — comes straight from readiness ──
  // Skip if the canvas is also empty (the canvas gap already covers the
  // first move) to avoid two amber rows pointing the founder at idea-shaping.
  if (
    inputs.readiness?.next_recommended_skill &&
    !ideaIsEmpty(inputs.idea)
  ) {
    const next = inputs.readiness.next_recommended_skill;
    out.push({
      id: `next_skill:${next.id}`,
      kind: 'next_skill',
      label: `Next move: ${next.label}`,
      why: `Stage ${next.stage_number} (${next.stage_name}) is below GO. ${next.label} is the cheapest unlock.`,
      fill_skill: next.id,
      fill_kickoff: next.kickoff,
      stage_number: next.stage_number,
      severity: 1,
    });
  }

  // ── 3. No market research (P2) ──────────────────────────────────────
  if (researchIsEmpty(inputs.research) && !ideaIsEmpty(inputs.idea)) {
    out.push({
      id: 'no_market_research',
      kind: 'no_market_research',
      label: 'No market research yet',
      why: 'TAM/SAM/SOM, trends, and key insights are missing — answers about market size will be hand-wavy.',
      fill_skill: 'market-research',
      fill_kickoff: kickoffFor('market-research', 'Run market research for this idea.'),
      stage_number: 2,
      severity: 2,
    });
  }

  // ── 4. No competitors mapped (P2) ───────────────────────────────────
  if (inputs.competitorsCount === 0 && !ideaIsEmpty(inputs.idea)) {
    out.push({
      id: 'no_competitors',
      kind: 'no_competitors',
      label: 'No competitors mapped',
      why: 'We can\'t position the wedge without knowing who else is in the space.',
      fill_skill: 'market-research',
      fill_kickoff: 'Who are the main competitors for this idea and how do they compare?',
      stage_number: 2,
      severity: 2,
    });
  }

  // ── 5. No risk audit (P2) ───────────────────────────────────────────
  if (!inputs.hasRiskAudit && !ideaIsEmpty(inputs.idea)) {
    out.push({
      id: 'no_risks',
      kind: 'no_risks',
      label: 'No risk audit',
      why: 'Risk scoring surfaces what could kill this — without it, GO verdicts are optimistic.',
      fill_skill: 'risk-scoring',
      fill_kickoff: kickoffFor('risk-scoring', 'Run a risk audit on this idea.'),
      stage_number: 2,
      severity: 2,
    });
  }

  // ── 6. No personas mapped (P3) — only meaningful once we have a market ─
  const hasPersonas = inputs.entities.some(
    (e) => e.node_type === 'persona' || e.node_type === 'customer',
  );
  if (!hasPersonas && inputs.idea?.target_market) {
    out.push({
      id: 'no_personas',
      kind: 'no_personas',
      label: 'No personas defined',
      why: 'Empathy maps and persona behavior shape every downstream skill (GTM, pricing, prototype).',
      fill_skill: 'scientific-validation',
      fill_kickoff: kickoffFor('scientific-validation', 'Generate buyer personas for this target market.'),
      stage_number: 2,
      severity: 3,
    });
  }

  // ── 7. No business model / pricing (P3) ─────────────────────────────
  if (
    !inputs.idea?.business_model &&
    inputs.idea?.solution &&
    inputs.idea?.target_market
  ) {
    out.push({
      id: 'no_pricing',
      kind: 'no_pricing',
      label: 'No business model picked',
      why: 'Pricing and monetization shape unit economics — leaving this blank blocks the financial model.',
      fill_skill: 'business-model',
      fill_kickoff: kickoffFor('business-model', 'Help me pick a business model and pricing approach.'),
      stage_number: 3,
      severity: 3,
    });
  }

  // ── 8. Zero confirmed facts on a project >= 2 days old (P4) ─────────
  // Skip for brand-new projects — they legitimately have no facts yet.
  if (inputs.factsCount === 0 && inputs.projectCreatedAt) {
    const ageMs = Date.now() - new Date(inputs.projectCreatedAt).getTime();
    if (ageMs > 2 * 24 * 60 * 60 * 1000) {
      out.push({
        id: 'no_facts',
        kind: 'no_facts',
        label: 'No confirmed insights yet',
        why: 'Chat conversations and signal saves haven\'t produced any applied facts — knowledge isn\'t compounding.',
        fill_skill: null,
        fill_kickoff: 'Tell me what you\'ve already learned about this market that I should capture.',
        stage_number: null,
        severity: 4,
      });
    }
  }

  // ── 9. Stale skills (P5) ────────────────────────────────────────────
  if (inputs.readiness) {
    for (const stage of inputs.readiness.stages) {
      for (const stale of stage.stale_skills) {
        out.push({
          id: `stale_skill:${stale.id}`,
          kind: 'stale_skill',
          label: `Refresh ${stale.label}`,
          why: `Stage ${stage.number} (${stage.name}) — last run > 14 days ago. Data may have drifted.`,
          fill_skill: stale.id,
          fill_kickoff: kickoffFor(stale.id, `Refresh the ${stale.label} skill for this project.`),
          stage_number: stage.number,
          severity: 5,
        });
      }
    }
  }

  // Sort by severity then by stage number so the founder reads top-down
  // from "blocker" → "stage 1" → "stage 2" → … without surprises.
  out.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity;
    return (a.stage_number ?? 99) - (b.stage_number ?? 99);
  });

  return out;
}

/**
 * Render the gap list as a compact markdown block for the chat system
 * prompt. Caps at top 5 so the prompt doesn't bloat — the agent only needs
 * to know what to *say next*, not the full backlog.
 */
export function formatGapsForPrompt(gaps: KnowledgeGap[]): string {
  if (gaps.length === 0) {
    return '## Known knowledge gaps\nNo material gaps — every stage has its core data. Push the founder toward operating concerns (metrics, fundraising, growth).';
  }
  const top = gaps.slice(0, 5);
  const lines: string[] = ['## Known knowledge gaps'];
  lines.push(
    'When the founder asks about any of these areas, name the gap explicitly ' +
      '("I don\'t have X yet") and offer the kickoff. Don\'t fabricate.',
  );
  for (const g of top) {
    const skillTag = g.fill_skill ? ` [skill: ${g.fill_skill}]` : '';
    lines.push(`- ${g.label}${skillTag} — ${g.why}`);
    lines.push(`  Kickoff: "${g.fill_kickoff}"`);
  }
  if (gaps.length > top.length) {
    lines.push(`(${gaps.length - top.length} more gaps not shown.)`);
  }
  return lines.join('\n');
}
