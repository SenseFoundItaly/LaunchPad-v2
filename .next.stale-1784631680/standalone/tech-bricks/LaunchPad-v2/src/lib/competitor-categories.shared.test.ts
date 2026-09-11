import { describe, it, expect } from 'vitest';
import { categoryForColumn, normalizeCategory } from '@/lib/competitor-categories.shared';

// First real test under the new vitest runner (B0). Also a genuine guardrail:
// the matryoshka decomposition depends on this column→category mapping, and a
// silent regression here would mis-bucket every competitor attribute.
describe('categoryForColumn', () => {
  it('maps pricing-ish columns to pricing', () => {
    expect(categoryForColumn('pricing')).toBe('pricing');
    expect(categoryForColumn('monthly_cost')).toBe('pricing');
    expect(categoryForColumn('plan_tier')).toBe('pricing');
  });
  it('maps strengths to competitive_advantage and weaknesses/threats to criticality', () => {
    expect(categoryForColumn('strengths')).toBe('competitive_advantage');
    expect(categoryForColumn('weaknesses')).toBe('criticality');
    expect(categoryForColumn('threat_level')).toBe('criticality');
  });
  it('maps distribution/product columns and falls back to general', () => {
    expect(categoryForColumn('distribution')).toBe('distribution');
    expect(categoryForColumn('product_features')).toBe('product');
    expect(categoryForColumn('target_customer')).toBe('general');
    expect(categoryForColumn('random_xyz')).toBe('general');
  });
  it('is first-match-wins (pricing rule precedes others)', () => {
    // "cost" hits the pricing rule before any later rule could.
    expect(categoryForColumn('cost')).toBe('pricing');
  });
});

describe('normalizeCategory', () => {
  it('canonicalizes free-text labels the agent may pass', () => {
    expect(normalizeCategory('Pricing')).toBe('pricing');
    expect(normalizeCategory('moat')).toBe('competitive_advantage');
    expect(normalizeCategory('gtm')).toBe('distribution');
    expect(normalizeCategory('threat')).toBe('criticality');
  });
  it('passes through an already-canonical category', () => {
    expect(normalizeCategory('product')).toBe('product');
  });
});
