/**
 * Stage 1 — Idea Validation.
 * The founder has an idea written down and can defend its shape: problem,
 * solution (sketched AND detailed), value prop, and the competitive edge.
 * Not market-validated yet — just articulated.
 *
 * Re-bucketing note (2026-06 taxonomy unification): absorbs all of legacy
 * "Spark" plus legacy "Solution"'s articulation checks (solution_detailed,
 * edge_articulated, value_prop_sharp). Solution's differentiation_evidence
 * moved to Stage 2 (Market Validation) because it needs market evidence,
 * not just articulation. Check ids and evaluator logic are unchanged.
 */

import type { Stage } from './types';
import { CANONICAL_BY_ID } from './canonical';

export const stageIdeaValidation: Stage = {
  ...CANONICAL_BY_ID.idea_validation,
  tagline: 'The idea written down — problem, solution, value prop, edge.',
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
      id: 'value_prop',
      label: 'Value proposition stated',
      source: 'idea_canvas.value_proposition',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.value_proposition?.trim();
        return ok
          ? { passed: true, evidence: "You've stated why the customer will care." }
          : { passed: false, gap: 'Say why the customer would care' };
      },
    },
    {
      id: 'solution_detailed',
      label: 'Solution described in depth',
      source: 'idea_canvas.solution',
      evaluate: (s) => {
        const sol = s.idea_canvas?.solution?.trim() ?? '';
        const ok = sol.length >= 80;
        return ok
          ? { passed: true, evidence: 'Your solution is described in enough detail to act on.' }
          : { passed: false, gap: 'Expand the solution description' };
      },
    },
    {
      id: 'edge_articulated',
      label: 'Competitive edge articulated',
      source: 'idea_canvas.competitive_advantage',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.competitive_advantage?.trim();
        return ok
          ? { passed: true, evidence: "You've named what makes you win against the alternatives." }
          : { passed: false, gap: 'Say why you win vs. the alternatives' };
      },
    },
    {
      id: 'value_prop_sharp',
      label: 'Value prop sharp',
      source: 'idea_canvas.value_proposition',
      evaluate: (s) => {
        const vp = s.idea_canvas?.value_proposition?.trim() ?? '';
        const ok = vp.length >= 30;
        return ok
          ? { passed: true, evidence: 'Your value proposition is sharp and specific.' }
          : { passed: false, gap: 'Tighten the value prop' };
      },
    },
  ],
};
