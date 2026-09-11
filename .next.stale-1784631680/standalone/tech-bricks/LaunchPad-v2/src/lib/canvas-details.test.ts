import { describe, it, expect } from 'vitest';
import { cleanCanvasDetails } from './canvas-details';

describe('cleanCanvasDetails', () => {
  it('trims text, filters/limits array items, drops empties', () => {
    expect(cleanCanvasDetails({
      unfair_advantage: '  Network effects from designer referrals  ',
      key_metrics: ['MRR', '  ', 'Churn', 42 as unknown as string],
      revenue_streams: ['Subscriptions'],
      cost_structure: [],
    })).toEqual({
      unfair_advantage: 'Network effects from designer referrals',
      key_metrics: ['MRR', 'Churn'],
      revenue_streams: ['Subscriptions'],
      cost_structure: null, // empty array → null (nothing to write, keeps existing)
    });
  });

  it('returns all-null for missing / non-string / whitespace inputs', () => {
    expect(cleanCanvasDetails({})).toEqual({ unfair_advantage: null, key_metrics: null, revenue_streams: null, cost_structure: null });
    expect(cleanCanvasDetails({ unfair_advantage: '   ', key_metrics: 'nope' as unknown as string[] }))
      .toEqual({ unfair_advantage: null, key_metrics: null, revenue_streams: null, cost_structure: null });
  });

  it('caps arrays at 12 items', () => {
    const km = Array.from({ length: 20 }, (_, i) => `m${i}`);
    expect(cleanCanvasDetails({ key_metrics: km }).key_metrics).toHaveLength(12);
  });
});
