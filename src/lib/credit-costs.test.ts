import { describe, it, expect } from 'vitest';
import { formatMessageCredits } from '@/lib/credit-costs';

// A2a: the per-message actual-credit display must NEVER render garbage for
// historical / in-flight / free messages — that's the whole point of showing
// the real number (the founder's "credits feel random" pain).
describe('formatMessageCredits', () => {
  it('renders nothing when cost is missing or not yet known', () => {
    expect(formatMessageCredits(undefined)).toBeNull();
    expect(formatMessageCredits(null)).toBeNull();
    expect(formatMessageCredits({})).toBeNull();
  });
  it('renders nothing for non-finite or non-positive cost (no "NaN cr"/"0 cr")', () => {
    expect(formatMessageCredits({ credits: NaN })).toBeNull();
    expect(formatMessageCredits({ credits: 0 })).toBeNull();
    expect(formatMessageCredits({ credits: -5 })).toBeNull();
    expect(formatMessageCredits({ credits: Infinity })).toBeNull();
  });
  it('rounds >=1 credit to an integer', () => {
    expect(formatMessageCredits({ credits: 53.2 })).toBe('53 cr');
    expect(formatMessageCredits({ credits: 1 })).toBe('1 cr');
    expect(formatMessageCredits({ credits: 149.7 })).toBe('150 cr');
  });
  it('shows one decimal for sub-1 credit', () => {
    expect(formatMessageCredits({ credits: 0.5 })).toBe('0.5 cr');
    expect(formatMessageCredits({ credits: 0.46 })).toBe('0.5 cr');
  });
});
