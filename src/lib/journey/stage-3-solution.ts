/**
 * Stage 3 — Solution definition.
 * The shape of what you'll build. Not yet code — but a clear enough mental
 * model that you can describe it, defend it, and prototype it.
 */

import type { Stage } from './types';
import { countMemoryFactsMatching } from './snapshot';

export const stageSolution: Stage = {
  id: 'solution',
  number: 3,
  label: 'Solution',
  tagline: 'What you will build and why it wins.',
  checks: [
    {
      id: 'solution_detailed',
      label: 'Solution detailed (80+ chars)',
      source: 'idea_canvas.solution',
      evaluate: (s) => {
        const sol = s.idea_canvas?.solution?.trim() ?? '';
        const ok = sol.length >= 80;
        return ok
          ? { passed: true, evidence: `Solution: ${sol.length} chars` }
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
          ? { passed: true, evidence: 'Edge captured in canvas' }
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
          ? { passed: true, evidence: `Value prop: ${vp.length} chars` }
          : { passed: false, gap: 'Tighten the value prop' };
      },
    },
    {
      id: 'differentiation_evidence',
      label: 'Differentiation evidenced',
      source: 'memory_facts (vs. competitors)',
      evaluate: (s) => {
        const n = countMemoryFactsMatching(s, ['unlike', 'better than', 'differentiator', 'vs', 'compared to']);
        const ok = n > 0;
        return ok
          ? { passed: true, evidence: `${n} differentiation fact${n === 1 ? '' : 's'}` }
          : { passed: false, gap: 'Pin what makes you different in chat' };
      },
    },
  ],
};
