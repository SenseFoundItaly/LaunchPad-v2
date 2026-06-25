import { describe, it, expect } from 'vitest';
import { marketSizingProse, buildResearchContext, marketSizeFromTamSamSom } from './research-context';

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

describe('marketSizeFromTamSamSom (write-shape mapper)', () => {
  // Exact tam-sam-som artifact payload shape (MarketSizeTier: value + confidence + extras).
  it('extracts value + confidence, dropping bulky artifact-only fields', () => {
    const artifact = {
      tam: { value: '$8B', numeric_usd: 8_000_000_000, methodology: 'long text', confidence: 'medium' },
      sam: { value: '$360M', numeric_usd: 360_000_000 },
      som: { value: '$9M' },
    };
    expect(marketSizeFromTamSamSom(artifact)).toEqual({
      tam: { value: '$8B', confidence: 'medium' },
      sam: { value: '$360M' },
      som: { value: '$9M' },
    });
  });

  // THE regression guard for the live T4→T7 coherence bug: a tam-sam-som the agent
  // emits must round-trip through the column so the SAME prose comes back next turn.
  it('round-trips: artifact → research.market_size → marketSizingProse', () => {
    const artifact = { tam: { value: '$8B', confidence: 'medium' }, sam: { value: '$360M' }, som: { value: '$9M' } };
    const stored = marketSizeFromTamSamSom(artifact);
    expect(marketSizingProse({ market_size: stored })).toBe('TAM $8B (medium confidence) · SAM $360M · SOM $9M');
  });

  it('returns null when no tier carries a usable value (never persists an empty/polluting row)', () => {
    expect(marketSizeFromTamSamSom(null)).toBeNull();
    expect(marketSizeFromTamSamSom(undefined)).toBeNull();
    expect(marketSizeFromTamSamSom({})).toBeNull();
    expect(marketSizeFromTamSamSom({ tam: { confidence: 'high' }, sam: {}, som: null })).toBeNull();
  });

  it('persists a partial sizing (e.g. SAM only)', () => {
    expect(marketSizeFromTamSamSom({ sam: { value: '$360M', confidence: 'low' } })).toEqual({ sam: { value: '$360M', confidence: 'low' } });
  });

  it('accepts the estimate alias (defensive parity with the reader)', () => {
    expect(marketSizeFromTamSamSom({ tam: { estimate: '€1.0B', confidence: 'medium' } })).toEqual({ tam: { value: '€1.0B', confidence: 'medium' } });
  });
});
