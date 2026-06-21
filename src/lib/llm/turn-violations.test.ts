import { describe, it, expect } from 'vitest';
import { analyzeTurnViolations, renderNudgeForNextTurn } from '@/lib/llm/turn-violations';

// B2: the anti-fabrication detector is part of the moat — skills only PROPOSE
// (they run async after approval), so prose claiming a skill's findings in the
// proposing turn is a lie. These pin the detector + the next-turn nudge.
describe('analyzeTurnViolations — prose_fabrication', () => {
  it('flags claiming skill outcomes when a skill_* tool was called this turn', () => {
    const v = analyzeTurnViolations(
      [{ name: 'skill_market_research' }],
      'The research shows TAM is $5B and competitors include Acme.',
      'do market research',
    );
    expect(v.prose_fabrication).toBe(true);
  });

  it('does NOT flag an honest "queued, not run" proposal', () => {
    const v = analyzeTurnViolations(
      [{ name: 'skill_market_research' }],
      "I've queued market research (~30 credits). Want me to run it?",
      'do market research',
    );
    expect(v.prose_fabrication).toBe(false);
  });

  it('does NOT flag outcome-claim prose when no skill tool was called', () => {
    const v = analyzeTurnViolations(
      [{ name: 'web_search' }],
      'The research shows TAM is $5B.', // claim, but no skill_* call → not fabrication
      'tell me the market size',
    );
    expect(v.prose_fabrication).toBe(false);
  });

  it('a clean turn (no skill tool, benign prose) has no violations', () => {
    const v = analyzeTurnViolations([], "Let's define the problem first.", 'hi');
    expect(v).toEqual({ skill_first_violation: false, prose_fabrication: false });
  });
});

describe('renderNudgeForNextTurn', () => {
  it('emits a corrective nudge when the prior turn fabricated', () => {
    const nudge = renderNudgeForNextTurn({ skill_first_violation: false, prose_fabrication: true });
    expect(nudge).toContain('claimed skill outcomes');
  });
  it('emits nothing when the prior turn was clean', () => {
    expect(renderNudgeForNextTurn({ skill_first_violation: false, prose_fabrication: false })).toBe('');
  });
});
