import { describe, it, expect } from 'vitest';
import { marketSizingProse, buildResearchContext } from './research-context';

describe('marketSizingProse', () => {
  // Real prod row shape (proj_bacac4a9): nested tiers with estimate + confidence.
  it('renders genuine TAM/SAM/SOM tiers', () => {
    const research = {
      market_size: {
        tam: { estimate: '~€1.0B', confidence: 'medium' },
        sam: { estimate: '~€365M', sources: [{ type: 'web' }] },
        som: { estimate: '~€18M' },
      },
    };
    expect(marketSizingProse(research)).toBe('TAM ~€1.0B (medium confidence) · SAM ~€365M · SOM ~€18M');
  });

  // Real prod row shape (proj_a8de0b69): a metric-grid (current-numbers
  // snapshot) mis-stored in research.market_size — must NOT render as sizing.
  it('returns null for a non-sizing metric-grid (pollution guard)', () => {
    const research = {
      market_size: {
        _title: 'CTO Marketplace -- Current Numbers Snapshot',
        MRR: { value: 'Not tracked', change: '--' },
        Users: { value: 'Not tracked', change: '--' },
        Runway: { value: 'Not set', change: '--' },
      },
    };
    expect(marketSizingProse(research)).toBeNull();
  });

  it('accepts flat string tiers', () => {
    expect(marketSizingProse({ market_size: { tam: '$5B', sam: '$500M' } })).toBe('TAM $5B · SAM $500M');
  });

  it('parses legacy double-encoded (stringified) market_size', () => {
    const research = { market_size: JSON.stringify({ tam: { estimate: '$2B' } }) };
    expect(marketSizingProse(research)).toBe('TAM $2B');
  });

  it('returns null for empty / missing research', () => {
    expect(marketSizingProse(null)).toBeNull();
    expect(marketSizingProse(undefined)).toBeNull();
    expect(marketSizingProse({})).toBeNull();
    expect(marketSizingProse({ market_size: null })).toBeNull();
    expect(marketSizingProse({ market_size: {} })).toBeNull();
  });

  it('ignores tiers with no usable value', () => {
    expect(marketSizingProse({ market_size: { tam: { confidence: 'high' }, sam: '$10M' } })).toBe('SAM $10M');
  });
});

describe('buildResearchContext', () => {
  it('wraps sizing in a reference block (not stage evidence)', () => {
    const block = buildResearchContext({ market_size: { tam: { estimate: '$700M' } } });
    expect(block).toContain('[RESEARCH CONTEXT — established market sizing]');
    expect(block).toContain('TAM $700M');
    expect(block).toMatch(/state the revision explicitly/i);
    expect(block).toMatch(/not.*stage-closure evidence/i);
  });

  it('returns empty string when there is no sizing (zero added tokens)', () => {
    expect(buildResearchContext(null)).toBe('');
    expect(buildResearchContext({ market_size: { MRR: { value: '$1k' } } })).toBe('');
  });
});
