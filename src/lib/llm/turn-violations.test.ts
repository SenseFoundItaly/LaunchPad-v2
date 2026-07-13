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
    expect(v).toEqual({ skill_first_violation: false, prose_fabrication: false, uncited_prose_claims: false });
  });

  it('flags Italian fabricated outcome claims (bilingual guard)', () => {
    for (const prose of [
      'La ricerca mostra che il TAM è di 5 miliardi.',
      'La dimensione del mercato è 40 milioni di euro.',
      'Abbiamo scoperto che i club pagherebbero il doppio.',
      'I risultati indicano una forte domanda.',
    ]) {
      const v = analyzeTurnViolations([{ name: 'skill_market_research' }], prose, 'fai la ricerca di mercato');
      expect(v.prose_fabrication, `must flag: "${prose}"`).toBe(true);
    }
  });

  it('does NOT flag honest Italian "queued, not run" prose', () => {
    const v = analyzeTurnViolations(
      [{ name: 'skill_market_research' }],
      'Ho messo in coda la ricerca di mercato (~30 crediti). Vuoi lanciarla?',
      'fai la ricerca di mercato',
    );
    expect(v.prose_fabrication).toBe(false);
  });
});

describe('hasUncitedProseClaim (gap 8)', () => {
  it('flags a currency-magnitude claim with no [N] marker', () => {
    const v = analyzeTurnViolations([], 'The agentic AI market hit $2.8B in H1 2025.', 'how big is it');
    expect(v.uncited_prose_claims).toBe(true);
  });
  it('flags a statute reference with no citation', () => {
    const v = analyzeTurnViolations([], 'That violates GDPR Article 6 and D.Lgs. 193/2007.', 'am I liable');
    expect(v.uncited_prose_claims).toBe(true);
  });
  it('flags an uncited percentage', () => {
    const v = analyzeTurnViolations([], 'Roughly 40% of agents get demoted by 2027.', 'trend?');
    expect(v.uncited_prose_claims).toBe(true);
  });
  it('does NOT flag the same claim when a [N] marker follows it', () => {
    const v = analyzeTurnViolations([], 'The market hit $2.8B [3] in H1 2025.', 'how big');
    expect(v.uncited_prose_claims).toBe(false);
  });
  it('does NOT flag the founder\'s own conversational figures', () => {
    const v = analyzeTurnViolations([], 'With €20k runway and 3km delivery radius, focus on one neighborhood.', 'advice');
    expect(v.uncited_prose_claims).toBe(false);
  });
  it('ignores numbers that live inside an artifact block (artifacts are source-gated separately)', () => {
    const withArtifact = 'Here is the map.\n:::artifact{"type":"tam-sam-som"}\n{"tam":"$5B","sources":[]}\n:::\nWhat next?';
    const v = analyzeTurnViolations([], withArtifact, 'market');
    expect(v.uncited_prose_claims).toBe(false);
  });
  it('the uncited nudge is rendered for the next turn', () => {
    const nudge = renderNudgeForNextTurn({ skill_first_violation: false, prose_fabrication: false, uncited_prose_claims: true });
    expect(nudge).toContain('[N] citation');
  });
});

describe('renderNudgeForNextTurn', () => {
  it('emits a corrective nudge when the prior turn fabricated', () => {
    const nudge = renderNudgeForNextTurn({ skill_first_violation: false, prose_fabrication: true, uncited_prose_claims: false });
    expect(nudge).toContain('claimed skill outcomes');
  });
  it('emits nothing when the prior turn was clean', () => {
    expect(renderNudgeForNextTurn({ skill_first_violation: false, prose_fabrication: false, uncited_prose_claims: false })).toBe('');
  });
});
