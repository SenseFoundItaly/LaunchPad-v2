import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { REAL_SPEND_ONLY } from './credit-costs';

/**
 * `llm_usage_logs` holds two kinds of row and only one is spend.
 *
 * `debitCredits` mirrors every charge into the same table so billing can be
 * shown beside cost. Those rows carry `model = 'credit'`, ZERO tokens, and
 * `total_cost_usd` = credits charged rather than dollars burned.
 *
 * Measured on prod 2026-08-14:
 *
 *   chat          327 rows · 1.45M in / 496k out · Sonnet 4.6 · $70.50  ← spend
 *   chat_message  334 rows · 0 tokens · model="credit"        · $66.80  ← NOT spend
 *
 * Three readers summed the column unfiltered, so the usage page reported $145
 * for a $79 month. The over-report GROWS with billing volume, not with cost —
 * so it gets worse exactly as the product succeeds, and any pricing decision
 * taken off that screen is made on roughly double the real number.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

const READERS = [
  'src/app/api/projects/[projectId]/usage/route.ts',
  'src/app/api/projects/[projectId]/usage/groups/route.ts',
  'src/lib/cost-meter.ts',
];

describe('every cost reader excludes the credit mirror', () => {
  it.each(READERS)('%s applies REAL_SPEND_ONLY', (f) => {
    expect(read(f)).toContain('REAL_SPEND_ONLY');
  });

  it.each(READERS)('%s has no unfiltered SUM(total_cost_usd) left', (f) => {
    const src = read(f);
    // Only real SQL — a template chunk that both sums the column AND reads the
    // table. Matching on the text alone flagged the doc comments that describe
    // these queries, which is a false positive, not a finding.
    const queries = src.split('`').filter(
      (chunk) => /SUM\(total_cost_usd\)/i.test(chunk) && /FROM\s+llm_usage_logs/i.test(chunk),
    );
    expect(queries.length, `${f}: no query found — did the file move?`).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q, `${f}: a SUM over llm_usage_logs without the filter`).toMatch(/REAL_SPEND_ONLY/);
    }
  });

  it('the predicate is NULL-safe — a real row with model NULL still counts', () => {
    // `model <> 'credit'` would drop NULL-model rows silently; IS DISTINCT FROM
    // keeps them, and real provider rows predate the model column being set.
    expect(REAL_SPEND_ONLY).toContain('IS DISTINCT FROM');
    expect(REAL_SPEND_ONLY).not.toMatch(/model\s*(<>|!=)\s*'credit'/);
  });

  it('is one shared constant, not three copies', () => {
    // Three readers had already drifted into reporting the inflated number; a
    // fourth would have too.
    expect(read('src/lib/credit-costs.ts')).toContain('export const REAL_SPEND_ONLY');
  });
});
