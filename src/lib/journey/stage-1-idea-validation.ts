/**
 * Stage 1 — Idea Validation (L2 spec Phase 0 — "Idea Canvas").
 * The founder structures the raw idea into a full Lean Canvas and sets the
 * Startup Scoring baseline for the whole cycle. Not market-validated yet —
 * assumptions made explicit before they harden into implicit certainties.
 *
 * Reworked 2026-07 to mirror the L2 Iteration Cycle spec Phase-0 step list
 * 1:1 (founder feedback: "il blocco Idea Canvas è rimasto uguale"):
 *   1. Problem statement defined
 *   2. Solution sketched
 *   3. Target & ICP defined (preliminary — revisited post-Loop 1)
 *   4. Value proposition stated
 *   5. Competitive advantage articulated (incl. unfair advantage / moat)
 *   6. Acquisition channels identified
 *   7. Main cost & revenue sources
 *   8. Lean Canvas compiled
 *   9. Startup Scoring baseline (displayed 0-100 — the skill rubric's scale)
 * The two legacy length-based extras (solution_detailed ≥80 chars,
 * value_prop_sharp ≥30 chars) were dropped — not in the spec list.
 * Target & ICP here is the PRELIMINARY canvas assertion; Stage 3 (Persona)
 * keeps the deeper fact-based ICP/channels validation.
 */

import type { Stage, ProjectSnapshot } from './types';
import { CANONICAL_BY_ID } from './canonical';

/** The 9 Lean Canvas blocks the `lean_canvas_compiled` check requires.
 *  Maps canonical Lean Canvas block → idea_canvas column. */
const LEAN_CANVAS_BLOCKS: Array<{ label: string; filled: (c: NonNullable<ProjectSnapshot['idea_canvas']>) => boolean }> = [
  { label: 'Problem', filled: (c) => !!c.problem?.trim() },
  { label: 'Solution', filled: (c) => !!c.solution?.trim() },
  { label: 'Key metrics', filled: (c) => (c.key_metrics?.length ?? 0) > 0 },
  { label: 'Value proposition', filled: (c) => !!c.value_proposition?.trim() },
  { label: 'Unfair advantage', filled: (c) => !!c.unfair_advantage?.trim() || !!c.competitive_advantage?.trim() },
  { label: 'Channels', filled: (c) => !!c.channels?.trim() },
  { label: 'Customer segments', filled: (c) => !!c.target_market?.trim() },
  { label: 'Cost structure', filled: (c) => (c.cost_structure?.length ?? 0) > 0 },
  { label: 'Revenue streams', filled: (c) => (c.revenue_streams?.length ?? 0) > 0 },
];

/** scores.overall_score canon is the startup-scoring rubric's 0-100 scale,
 *  but legacy rows (gauge-chart artifacts before the write-side normalization)
 *  carry 0-10 values. Normalize for display — one scale everywhere, /100
 *  (founder feedback 21/07: copilot said 6.8 while Home said /100). */
export function baselineScore100(overall: number): number {
  return overall <= 10 ? overall * 10 : overall;
}

export const stageIdeaValidation: Stage = {
  ...CANONICAL_BY_ID.idea_validation,
  tagline: 'The idea structured — Lean Canvas compiled, baseline score set.',
  checks: [
    {
      id: 'problem_defined',
      label: 'Problem statement defined',
      source: 'idea_canvas.problem',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.problem?.trim();
        return ok
          ? { passed: true, evidence: "You've written down the problem you're solving." }
          : { passed: false, gap: 'Write a one-line problem statement in chat' };
      },
    },
    {
      id: 'solution_sketched',
      label: 'Solution sketched',
      source: 'idea_canvas.solution',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.solution?.trim();
        return ok
          ? { passed: true, evidence: "You've described the solution you'll build." }
          : { passed: false, gap: 'Describe what you would build' };
      },
    },
    {
      id: 'target_icp_defined',
      label: 'Target & ICP defined (preliminary)',
      source: 'idea_canvas.target_market',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.target_market?.trim();
        return ok
          ? { passed: true, evidence: "You've named who this is for — revisited after Loop 1." }
          : { passed: false, gap: 'Name the target market and ideal customer' };
      },
    },
    {
      id: 'value_prop',
      label: 'Value proposition stated',
      source: 'idea_canvas.value_proposition',
      evaluate: (s) => {
        // Triviality floor, not a quality judgment: a one-word default like
        // "Faster" must not flip the most critical Stage-1 check green. A real
        // USP sentence (who + why over the alternative) clears this easily.
        const v = s.idea_canvas?.value_proposition?.trim() ?? '';
        const ok = v.length >= 25 && v.split(/\s+/).length >= 5;
        return ok
          ? { passed: true, evidence: "You've stated why the customer will care." }
          : { passed: false, gap: 'State a full value proposition — who it’s for and why it beats their current alternative' };
      },
    },
    {
      id: 'edge_articulated',
      label: 'Competitive advantage articulated (incl. unfair advantage / moat)',
      source: 'idea_canvas.competitive_advantage',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.competitive_advantage?.trim();
        if (!ok) return { passed: false, gap: 'Say why you win vs. the alternatives — include your unfair advantage or moat' };
        const moat = !!s.idea_canvas?.unfair_advantage?.trim();
        return {
          passed: true,
          evidence: moat
            ? "You've named your edge and the unfair advantage behind it."
            : "You've named what makes you win against the alternatives.",
        };
      },
    },
    {
      id: 'channels_defined',
      label: 'Acquisition channels identified',
      source: 'idea_canvas.channels',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.channels?.trim();
        return ok
          ? { passed: true, evidence: "You've identified how you'll reach customers." }
          : { passed: false, gap: 'Identify at least one acquisition channel' };
      },
    },
    {
      id: 'cost_revenue_defined',
      label: 'Main cost & revenue sources',
      source: 'idea_canvas.cost_structure',
      evaluate: (s) => {
        const costs = s.idea_canvas?.cost_structure?.length ?? 0;
        const revenues = s.idea_canvas?.revenue_streams?.length ?? 0;
        const ok = costs > 0 && revenues > 0;
        if (ok) return { passed: true, evidence: `${costs} cost item(s) and ${revenues} revenue source(s) mapped.` };
        const missing = [costs === 0 ? 'main costs' : null, revenues === 0 ? 'revenue sources' : null]
          .filter(Boolean)
          .join(' and ');
        return { passed: false, gap: `List your ${missing}` };
      },
    },
    {
      id: 'lean_canvas_compiled',
      label: 'Lean Canvas compiled',
      source: 'idea_canvas',
      evaluate: (s) => {
        const c = s.idea_canvas;
        if (!c) return { passed: false, gap: 'Start the Lean Canvas — describe the idea in chat' };
        const missing = LEAN_CANVAS_BLOCKS.filter((b) => !b.filled(c)).map((b) => b.label);
        return missing.length === 0
          ? { passed: true, evidence: 'All 9 Lean Canvas blocks are filled in.' }
          : { passed: false, gap: `Fill the remaining Lean Canvas block(s): ${missing.join(', ')}` };
      },
    },
    {
      id: 'startup_scoring_baseline',
      label: 'Startup Scoring baseline (0-100)',
      source: 'scores.overall_score',
      evaluate: (s) => {
        // > 0: chat radar-chart/score-card artifacts insert junk 0-score rows;
        // a zero baseline must not green the check with no founder-run scoring.
        const overall = s.startup_score?.overall_score;
        return overall != null && overall > 0
          ? { passed: true, evidence: `Baseline score: ${Math.round(baselineScore100(overall))}/100 — the reference for the whole cycle.` }
          : { passed: false, gap: 'Run the Startup Scoring analysis to set your baseline' };
      },
    },
  ],
};
