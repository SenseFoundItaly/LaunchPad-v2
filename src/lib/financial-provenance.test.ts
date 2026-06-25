import { describe, it, expect } from 'vitest';
import { deriveAssumptionsFromProject } from './financial-provenance';

describe('deriveAssumptionsFromProject', () => {
  it('derives monthly ARPU + currency from a real canvas business model', () => {
    // Real prod row (proj_0456765e): "€49 per practitioner per month, billed annually".
    const r = deriveAssumptionsFromProject({
      canvas: { business_model: 'Per-seat SaaS at €49 per practitioner per month, billed annually, sold to clinics.' },
    });
    expect(r.assumptions.arpu_monthly).toBe(49);
    expect(r.assumptions.currency).toBe('EUR');
    expect(r.provenance.arpu_monthly).toMatch(/Idea Canvas/);
  });

  it('converts an annual seat price to monthly', () => {
    const r = deriveAssumptionsFromProject({ canvas: { business_model: '$1,200 per seat per year' } });
    expect(r.assumptions.arpu_monthly).toBe(100);
    expect(r.assumptions.currency).toBe('USD');
    expect(r.provenance.arpu_monthly).toMatch(/÷ 12/);
  });

  it('does NOT mistake a market-size figure for a seat price (no cadence cue)', () => {
    const r = deriveAssumptionsFromProject({ canvas: { value_proposition: 'A $10M ARR opportunity in a $2B market.' } });
    expect(r.assumptions.arpu_monthly).toBeUndefined();
    expect(Object.keys(r.provenance)).toHaveLength(0);
  });

  it('returns empty when there is no pricing signal', () => {
    expect(deriveAssumptionsFromProject({ canvas: { problem: 'X', solution: 'Y' } }).assumptions).toEqual({});
    expect(deriveAssumptionsFromProject({}).assumptions).toEqual({});
    expect(deriveAssumptionsFromProject({ canvas: null }).provenance).toEqual({});
  });

  it('reads pricing from £ / per user / monthly forms', () => {
    expect(deriveAssumptionsFromProject({ canvas: { business_model: '£29/mo per user' } }).assumptions).toMatchObject({ arpu_monthly: 29, currency: 'GBP' });
    expect(deriveAssumptionsFromProject({ canvas: { revenue_streams: 'Subscription, $79 per user per month' } }).assumptions.arpu_monthly).toBe(79);
  });

  // pricing_state is the canonical Stage-4 price the founder commits via set_pricing;
  // the financial model must derive ARPU from it so chat sketch + Financials page agree.
  it('derives ARPU + currency from pricing_state.anchor_price (PRIMARY source)', () => {
    const r = deriveAssumptionsFromProject({ pricing: { anchor_price: 29, currency: 'eur' } });
    expect(r.assumptions.arpu_monthly).toBe(29);
    expect(r.assumptions.currency).toBe('EUR');
    expect(r.provenance.arpu_monthly).toBe('Pricing — anchor price');
  });

  it('pricing_state anchor_price takes PRECEDENCE over canvas prose', () => {
    const r = deriveAssumptionsFromProject({
      pricing: { anchor_price: 29 },
      canvas: { business_model: '€49 per seat per month' }, // stale canvas price
    });
    expect(r.assumptions.arpu_monthly).toBe(29); // the committed anchor wins, not the prose
    expect(r.provenance.arpu_monthly).toBe('Pricing — anchor price');
  });

  it('accepts a stringy anchor_price and ignores a zero/empty one', () => {
    expect(deriveAssumptionsFromProject({ pricing: { anchor_price: '49' } }).assumptions.arpu_monthly).toBe(49);
    // anchor_price 0 / missing → fall through to canvas
    expect(deriveAssumptionsFromProject({ pricing: { anchor_price: 0 }, canvas: { business_model: '$15/mo per user' } }).assumptions.arpu_monthly).toBe(15);
  });
});
