import { describe, it, expect, vi } from 'vitest';

// getLangfuse() gates on LANGFUSE_SECRET_KEY (read at call time) — leave unset
// so importing telemetry.ts doesn't try to construct a real client.
vi.mock('@/lib/db', () => ({ run: vi.fn(), get: vi.fn(), query: vi.fn() }));

import { mapToLangfuseModelId, toLangfuseUsageAndCost } from '@/lib/telemetry';

describe('toLangfuseUsageAndCost', () => {
  it('sums input+output+cache tokens into total (not just input+output)', () => {
    // Regression guard: Langfuse's own price/usage calc ignores cache tokens
    // entirely, undercounting by ~42% on cached calls (documented in
    // telemetry.ts) — our usageDetails.total must include them.
    const { usageDetails } = toLangfuseUsageAndCost(
      { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 20, cache_read_input_tokens: 30 },
      0.01,
    );
    expect(usageDetails.total).toBe(200);
    expect(usageDetails.input).toBe(100);
    expect(usageDetails.output).toBe(50);
  });

  it('omits costDetails when cost is 0 (lets Langfuse fall back to its own price table)', () => {
    const { costDetails } = toLangfuseUsageAndCost({ input_tokens: 10, output_tokens: 5 }, 0);
    expect(costDetails).toBeUndefined();
  });

  it('sets costDetails.total when cost is positive (our authoritative number wins)', () => {
    const { costDetails } = toLangfuseUsageAndCost({ input_tokens: 10, output_tokens: 5 }, 0.0042);
    expect(costDetails).toEqual({ total: 0.0042 });
  });

  it('defaults missing token fields to 0 rather than NaN', () => {
    const { usageDetails } = toLangfuseUsageAndCost({}, 0);
    expect(usageDetails).toEqual({ input: 0, output: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, total: 0 });
  });
});

describe('mapToLangfuseModelId', () => {
  it('passes an unrecognized slug through unchanged', () => {
    expect(mapToLangfuseModelId('some-unknown-model-slug')).toBe('some-unknown-model-slug');
  });

  it('falls back to "unknown" when model is undefined', () => {
    expect(mapToLangfuseModelId(undefined)).toBe('unknown');
  });
});
