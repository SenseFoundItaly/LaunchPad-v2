import { describe, it, expect } from 'vitest';
import { creditsFromUsd, median, CREDITS_PER_DOLLAR } from '@/lib/credit-costs';

// A2b: the skill credit estimate is derived from real USD via these pure helpers.
describe('creditsFromUsd', () => {
  it('converts at the cost-true ~5 credits/$ unit and rounds', () => {
    // market-research ~ $0.50 → ~3 cr under the 50 cr / $10 unit (5 cr/$)
    expect(creditsFromUsd(0.5)).toBe(Math.round(0.5 * CREDITS_PER_DOLLAR));
    expect(creditsFromUsd(0.5)).toBe(3);
  });
  it('returns 0 for non-positive / non-finite (no negative or NaN estimate)', () => {
    expect(creditsFromUsd(0)).toBe(0);
    expect(creditsFromUsd(-1)).toBe(0);
    expect(creditsFromUsd(NaN)).toBe(0);
  });
  it('shows a decimal for sub-1-credit costs', () => {
    expect(creditsFromUsd(0.1)).toBe(0.5); // 0.1 * 5 = 0.5 cr (sub-1 keeps a decimal)
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
