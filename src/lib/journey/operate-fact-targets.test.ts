import { describe, it, expect } from 'vitest';
import { validationTargetsFor, validationLabel, isGatedWrite } from './validation-targets';

// Operate-stage digest kinds (plan happy-beacon B1): metric / financial_fact /
// brand_fact. These assert the item→check wiring lands on the REAL Stage-6/7
// sources and can't drift from the spine (same guard style as
// tech-fact-targets.test.ts).

describe('metric validation targets', () => {
  it('maps to the Stage-7 metrics_tracked check', () => {
    const t = validationTargetsFor('metric');
    expect(t.map((x) => x.check_id)).toEqual(['metrics_tracked']);
    expect(t[0]?.stage_number).toBe(7);
    expect(validationLabel(t)).toMatch(/Stage 7/);
    expect(isGatedWrite('metric')).toBe(true);
  });
});

describe('financial_fact validation targets', () => {
  it('burn and cash map to the Stage-6 runway check', () => {
    for (const field of ['burn', 'cash'] as const) {
      const t = validationTargetsFor('financial_fact', field);
      expect(t.map((x) => x.check_id)).toEqual(['runway_clear']);
      expect(t[0]?.stage_number).toBe(6);
    }
  });

  it('revenue maps to Stage-6 capital_plan AND Stage-7 metrics (an MRR metric feeds both)', () => {
    const t = validationTargetsFor('financial_fact', 'revenue');
    const ids = t.map((x) => x.check_id).sort();
    expect(ids).toEqual(['capital_plan', 'metrics_tracked']);
  });

  it('an unknown / missing field maps to no check (never a phantom green)', () => {
    expect(validationTargetsFor('financial_fact')).toEqual([]);
    expect(validationTargetsFor('financial_fact', 'bogus')).toEqual([]);
  });
});

describe('brand_fact stays context', () => {
  it('maps to no spine check — staged for approval but validates nothing', () => {
    expect(validationTargetsFor('brand_fact', 'positioning')).toEqual([]);
    expect(isGatedWrite('brand_fact', 'positioning')).toBe(false);
  });
});
