import { describe, it, expect } from 'vitest';
import { isClarificationOnly } from '@/lib/skill-output';

// B2: a skill that only asked clarifying questions is NOT a deliverable — it must
// not count as 'completed', score readiness, or fake an artifact. This gate is
// the moat against empty/clarification-only runs being persisted as real work.
describe('isClarificationOnly', () => {
  it('treats empty / whitespace output as non-deliverable', () => {
    expect(isClarificationOnly('')).toBe(true);
    expect(isClarificationOnly('   \n ')).toBe(true);
    expect(isClarificationOnly(null)).toBe(true);
    expect(isClarificationOnly(undefined)).toBe(true);
  });

  it('flags a clarification request (asks for input + multiple questions, no structure)', () => {
    const text = 'I need a bit more before I can start. What does your product do? Who is the customer?';
    expect(isClarificationOnly(text)).toBe(true);
  });

  it('does NOT flag a real deliverable with structure', () => {
    const text = '## Market Analysis\n\nTAM is roughly $5B based on bottoms-up sizing. SAM ~ $400M.';
    expect(isClarificationOnly(text)).toBe(false);
  });

  it('spares clarification-shaped text that ALSO carries strong deliverable structure', () => {
    const text = 'I need more detail. What is your pricing? Who buys?\n\n## Findings\n{"tam":"$5B"}';
    expect(isClarificationOnly(text)).toBe(false);
  });

  it('does NOT flag a single-question deliverable (needs 2+ questions + clarification phrasing)', () => {
    expect(isClarificationOnly('Your strongest wedge is SMB invoicing. Want me to size it?')).toBe(false);
  });
});
