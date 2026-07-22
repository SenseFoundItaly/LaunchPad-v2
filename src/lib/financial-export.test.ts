import { describe, it, expect } from 'vitest';
import { buildFinancialExport } from './financial-export';

// The engine's scenarios carry key/label ('base'/'Base'), never `name`, so the
// CSV used to label every section "# scenario" — three indistinguishable blocks
// in Excel (#167). Each scenario must now export under its own label.
describe('buildFinancialExport — scenario labels', () => {
  const model = {
    scenarios: [
      { key: 'base', label: 'Base', monthly_projections: [{ month: 1, mrr: 100 }] },
      { key: 'optimistic', label: 'Optimistic', monthly_projections: [{ month: 1, mrr: 140 }] },
      { key: 'pessimistic', label: 'Pessimistic', monthly_projections: [{ month: 1, mrr: 60 }] },
    ],
  };

  it('labels each scenario by its own label (not a shared "# scenario")', () => {
    const out = buildFinancialExport(model)!;
    expect(out.mime).toBe('text/csv');
    expect(out.text).toContain('# Base');
    expect(out.text).toContain('# Optimistic');
    expect(out.text).toContain('# Pessimistic');
    expect(out.text).not.toContain('# scenario');
  });

  it('falls back label→name→key→scenario', () => {
    const out = buildFinancialExport({
      scenarios: [
        { name: 'Aggressive', monthly_projections: [{ month: 1, mrr: 1 }] },  // no label → name
        { key: 'lean', monthly_projections: [{ month: 1, mrr: 1 }] },          // no label/name → key
      ],
    })!;
    expect(out.text).toContain('# Aggressive');
    expect(out.text).toContain('# lean');
  });
});
