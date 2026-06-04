/**
 * Stage 1 — Spark.
 * The founder has an idea written down. Minimum viable canvas: problem,
 * solution, value prop. Not validated yet — just articulated.
 */

import type { Stage } from './types';

export const stageSpark: Stage = {
  id: 'spark',
  number: 1,
  label: 'Spark',
  tagline: 'The idea, written down.',
  checks: [
    {
      id: 'problem_defined',
      label: 'Problem statement defined',
      source: 'idea_canvas.problem',
      evaluate: (s) => {
        const ok = !!s.idea_canvas?.problem?.trim();
        return ok
          ? { passed: true, evidence: 'Problem articulated in canvas' }
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
          ? { passed: true, evidence: 'Solution drafted' }
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
          ? { passed: true, evidence: 'Value prop captured' }
          : { passed: false, gap: 'Say why the customer would care' };
      },
    },
  ],
};
