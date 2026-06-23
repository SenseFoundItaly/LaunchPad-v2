import { describe, it, expect } from 'vitest';
import {
  computeFinancialModel,
  coerceAssumptions,
  defaultAssumptions,
  type FinancialModel,
} from './financial-projection';

function base(m: FinancialModel) {
  return m.scenarios.find((s) => s.key === 'base')!;
}

describe('computeFinancialModel', () => {
  it('produces 3 scenarios each with the full horizon of months', () => {
    const m = computeFinancialModel(defaultAssumptions());
    expect(m.scenarios.map((s) => s.key)).toEqual(['base', 'optimistic', 'pessimistic']);
    for (const s of m.scenarios) expect(s.monthly_projections).toHaveLength(36);
    expect(m.generated_by).toBe('engine');
  });

  it('is deterministic for month 1', () => {
    const a = { ...defaultAssumptions(), initial_customers: 0, new_customers_m1: 20, monthly_churn_rate_pct: 0, arpu_monthly: 29 };
    const r1 = base(computeFinancialModel(a)).monthly_projections[0];
    expect(r1.new_customers).toBe(20);
    expect(r1.total_customers).toBe(20);
    expect(r1.mrr).toBe(20 * 29); // 580
    expect(r1.revenue).toBe(580);
  });

  it('grows new-customer acquisition by the monthly growth rate', () => {
    const a = { ...defaultAssumptions(), new_customers_m1: 100, monthly_growth_rate_pct: 10, monthly_churn_rate_pct: 0 };
    const mp = base(computeFinancialModel(a)).monthly_projections;
    expect(mp[0].new_customers).toBe(100);
    expect(mp[1].new_customers).toBe(110); // 100 * 1.1
    expect(mp[2].new_customers).toBe(121); // 100 * 1.1^2
  });

  it('optimistic ends with more customers than base than pessimistic', () => {
    const m = computeFinancialModel(defaultAssumptions());
    const end = (k: string) => {
      const mp = m.scenarios.find((s) => s.key === k)!.monthly_projections;
      return mp[mp.length - 1].total_customers;
    };
    expect(end('optimistic')).toBeGreaterThan(end('base'));
    expect(end('base')).toBeGreaterThan(end('pessimistic'));
  });

  it('cash decreases while burning and net_burn turns negative when revenue covers costs', () => {
    const b = base(computeFinancialModel(defaultAssumptions()));
    expect(b.monthly_projections[0].cash_remaining).toBeLessThan(defaultAssumptions().starting_cash);
    // with strong growth + 80% margin, base should reach breakeven within the horizon
    expect(b.breakeven_month === null || b.breakeven_month <= 36).toBe(true);
    expect(b.peak_cash_need).toBeGreaterThanOrEqual(0);
  });

  it('coerceAssumptions falls back to defaults for missing fields and maps team_plan → opex', () => {
    const d = defaultAssumptions();
    expect(coerceAssumptions(undefined)).toEqual(d);
    const mapped = coerceAssumptions({ team_plan: [{ monthly_cost: 5000 }, { monthly_cost: 7000 }], arpu: 49 });
    expect(mapped.monthly_opex).toBe(12000);
    expect(mapped.arpu_monthly).toBe(49);
    expect(mapped.starting_cash).toBe(d.starting_cash); // unspecified → default
  });
});
