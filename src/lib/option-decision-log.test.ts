import { describe, it, expect } from 'vitest';
import { findOptionDecision } from './option-decision-log';

// findOptionDecision — decision-history mining for option-set clicks. The
// chosen payload is the option's FULL label (split.full), possibly with the
// description appended; the helper must find the right set across recent
// assistant messages and return the discarded siblings.

const optionSet = (prompt: string, labels: string[]): string => {
  const options = labels.map((label, i) => ({ id: `o${i}`, label, description: `desc ${i}` }));
  return [
    'Some prose before.',
    `:::artifact{"type":"option-set","id":"opt_x"}`,
    JSON.stringify({ prompt, options }),
    ':::',
  ].join('\n');
};

describe('findOptionDecision', () => {
  it('returns the discarded siblings and the prompt for an exact label match', () => {
    const content = optionSet('Quale value prop?', ['USP per dentisti', 'USP per cliniche', 'USP orizzontale']);
    const d = findOptionDecision([content], 'USP per cliniche')!;
    expect(d).not.toBeNull();
    expect(d.prompt).toBe('Quale value prop?');
    expect(d.discarded).toEqual(['USP per dentisti', 'USP orizzontale']);
  });

  it('matches when the chosen text carries the appended description ("label — description")', () => {
    const content = optionSet('Pick one', ['Option Alpha', 'Option Beta']);
    const d = findOptionDecision([content], 'Option Alpha — desc 0')!;
    expect(d.discarded).toEqual(['Option Beta']);
  });

  it('scans across multiple recent messages (the set may not be the latest)', () => {
    const newest = 'Just prose, no artifacts here.';
    const older = optionSet('Scegli', ['A lungo termine', 'B breve termine']);
    const d = findOptionDecision([newest, older], 'B breve termine')!;
    expect(d.discarded).toEqual(['A lungo termine']);
  });

  it('returns null when no option-set matches (free-typed "I choose" message)', () => {
    const content = optionSet('Pick', ['Alpha', 'Beta']);
    expect(findOptionDecision([content], 'something the founder typed freely')).toBeNull();
    expect(findOptionDecision([], 'Alpha')).toBeNull();
  });
});
