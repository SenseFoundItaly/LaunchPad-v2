import { describe, it, expect } from 'vitest';
import { parseAmount, marketSizeDrift, fmtAmount } from './market-size-coherence';

describe('parseAmount', () => {
  it('parses suffixed amounts', () => {
    expect(parseAmount('$888M')).toBe(8.88e8);
    expect(parseAmount('~€365M')).toBe(3.65e8);
    expect(parseAmount('$1.0B')).toBe(1e9);
    expect(parseAmount('12 billion')).toBe(1.2e10);
    expect(parseAmount('$2.4B')).toBe(2.4e9);
    expect(parseAmount('500k')).toBe(5e5);
  });
  it('parses plain and comma-grouped numbers', () => {
    expect(parseAmount('$1,340,000,000')).toBe(1.34e9);
    expect(parseAmount(700000000)).toBe(7e8);
  });
  it('takes the first figure from a range', () => {
    expect(parseAmount('€1.8M–€7.3M ARR')).toBe(1.8e6);
  });
  it('returns null for non-numeric / junk', () => {
    expect(parseAmount('Not tracked')).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount({})).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('marketSizeDrift', () => {
  const nested = (tam: string, sam?: string) => ({ tam: { estimate: tam }, ...(sam ? { sam: { estimate: sam } } : {}) });

  it('flags a material TAM change (the silent-overwrite case)', () => {
    const d = marketSizeDrift(nested('$700M'), nested('$79M'));
    expect(d).not.toBeNull();
    expect(d!.metric).toBe('TAM');
    expect(d!.oldAmount).toBe(7e8);
    expect(d!.newAmount).toBe(7.9e7);
    expect(d!.deltaPct).toBeGreaterThan(0.8);
  });

  it('returns null for an immaterial change (< 20%)', () => {
    expect(marketSizeDrift(nested('$700M'), nested('$770M'))).toBeNull(); // +10%
  });

  it('reports the WORST tier when several drift', () => {
    const d = marketSizeDrift(nested('$700M', '$120M'), nested('$650M', '$12M'));
    expect(d!.metric).toBe('SAM'); // SAM 10x drift dominates TAM's ~7%
  });

  it('ignores tiers that are not comparable (junk/missing)', () => {
    expect(marketSizeDrift({ tam: { estimate: 'Not tracked' } }, nested('$79M'))).toBeNull();
    expect(marketSizeDrift({ MRR: { value: '$1k' } }, { MRR: { value: '$9k' } })).toBeNull();
  });

  it('handles flat string tiers and is symmetric on threshold', () => {
    expect(marketSizeDrift({ tam: '$1B' }, { tam: '$2B' })!.deltaPct).toBe(1);
    expect(marketSizeDrift(null, nested('$1B'))).toBeNull();
  });
});

describe('fmtAmount', () => {
  it('renders compact labels', () => {
    expect(fmtAmount(8.88e8)).toBe('$888.0M');
    expect(fmtAmount(1.34e9)).toBe('$1.34B');
    expect(fmtAmount(5e5)).toBe('$500K');
  });
});
