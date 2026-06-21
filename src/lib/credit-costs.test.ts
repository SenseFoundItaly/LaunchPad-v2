import { describe, it, expect } from 'vitest';
import { formatMessageCredits, creditsFromUsd, median, CREDITS_PER_DOLLAR } from '@/lib/credit-costs';

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

// A2b: the skill credit estimate is derived from real USD via these pure helpers.
describe('creditsFromUsd', () => {
  it('converts at ~300 credits/$ (3x markup) and rounds', () => {
    // market-research ~ $0.50 → ~150 cr (the honest number vs the old "≈4")
    expect(creditsFromUsd(0.5)).toBe(Math.round(0.5 * CREDITS_PER_DOLLAR));
    expect(creditsFromUsd(0.5)).toBeGreaterThan(100);
  });
  it('returns 0 for non-positive / non-finite (no negative or NaN estimate)', () => {
    expect(creditsFromUsd(0)).toBe(0);
    expect(creditsFromUsd(-1)).toBe(0);
    expect(creditsFromUsd(NaN)).toBe(0);
  });
  it('shows a decimal for sub-1-credit costs', () => {
    expect(creditsFromUsd(0.001)).toBeCloseTo(0.3, 5); // 0.001 * 300 = 0.3
  });
});

describe('median', () => {
  it('returns the middle of an odd-length set', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('averages the two middles of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('ignores non-finite values and returns null when empty', () => {
    expect(median([NaN, Infinity, 5])).toBe(5);
    expect(median([])).toBeNull();
    expect(median([NaN])).toBeNull();
  });
});
