/**
 * Deterministic financial-projection engine.
 *
 * The financial-model SKILL produces a rich LLM-authored model, but it isn't
 * EDITABLE — once generated, a founder can only download it or re-run the skill.
 * This engine makes projections editable: a founder edits a small set of
 * ASSUMPTIONS and the full 36-month, 3-scenario projection recomputes
 * deterministically (no LLM, no cost, instant). Pure functions only — fully
 * unit-testable; the route stamps `generated_at`.
 *
 * Output is export-friendly (scenarios as an ARRAY with monthly_projections[],
 * matching financial-export.ts Shape B → clean CSV).
 */

export interface FinancialAssumptions {
  currency: string;                 // 'EUR' | 'USD' | …
  starting_cash: number;            // cash on hand at month 0
  arpu_monthly: number;             // revenue per customer per month
  gross_margin_pct: number;         // 0–100
  initial_customers: number;        // customers at month 0
  new_customers_m1: number;         // new customers acquired in month 1 (base scenario)
  monthly_growth_rate_pct: number;  // MoM growth of NEW-customer acquisition
  monthly_churn_rate_pct: number;   // % of customers lost per month
  monthly_opex: number;             // fixed monthly operating expense (team, infra, …)
  horizon_months: number;           // projection horizon (default 36)
}

export interface MonthRow {
  month: number;
  new_customers: number;
  churned_customers: number;
  total_customers: number;
  mrr: number;
  revenue: number;
  cogs: number;
  gross_margin_pct: number;
  opex: number;
  net_burn: number;                 // opex + cogs − revenue  (positive = burning cash)
  cash_remaining: number;
  runway_months: number | null;     // months of cash left at current burn; null if profitable
}

export interface YearSummary {
  year: number;
  arr: number;
  total_revenue: number;
  total_costs: number;
  net_income: number;
  ending_customers: number;
  ending_cash: number;
}

export interface Scenario {
  key: 'base' | 'optimistic' | 'pessimistic';
  label: string;
  monthly_projections: MonthRow[];
  year_summaries: YearSummary[];
  breakeven_month: number | null;   // first month net_burn ≤ 0
  peak_cash_need: number;           // extra capital needed beyond starting_cash to stay solvent
  ending_cash: number;
}

export interface FinancialModel {
  assumptions: FinancialAssumptions;
  scenarios: Scenario[];
  generated_by: 'engine' | 'skill';
  generated_at?: string;
}

const SCENARIO_DEFS: Array<{ key: Scenario['key']; label: string; acqMult: number; churnMult: number }> = [
  { key: 'base', label: 'Base', acqMult: 1, churnMult: 1 },
  { key: 'optimistic', label: 'Optimistic', acqMult: 1.4, churnMult: 0.7 },
  { key: 'pessimistic', label: 'Pessimistic', acqMult: 0.6, churnMult: 1.4 },
];

const round = (n: number) => Math.round(n);
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export function defaultAssumptions(): FinancialAssumptions {
  return {
    currency: 'EUR',
    starting_cash: 150_000,
    arpu_monthly: 29,
    gross_margin_pct: 80,
    initial_customers: 0,
    new_customers_m1: 20,
    monthly_growth_rate_pct: 12,
    monthly_churn_rate_pct: 4,
    monthly_opex: 18_000,
    horizon_months: 36,
  };
}

/**
 * Best-effort map of an arbitrary stored model's assumptions (LLM-skill shape or
 * engine shape) into the editable schema, falling back to defaults per-field so
 * the editor always opens with sane values.
 */
export function coerceAssumptions(raw: unknown): FinancialAssumptions {
  const d = defaultAssumptions();
  const a = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
  // tolerate a few alternate field names the skill used
  const cacToOpex = a.team_plan && Array.isArray(a.team_plan)
    ? (a.team_plan as Array<{ monthly_cost?: number }>).reduce((s, t) => s + num(t?.monthly_cost, 0), 0)
    : undefined;
  return {
    currency: typeof a.currency === 'string' ? a.currency : d.currency,
    starting_cash: num(a.starting_cash, d.starting_cash),
    arpu_monthly: num(a.arpu_monthly ?? a.arpu, d.arpu_monthly),
    gross_margin_pct: num(a.gross_margin_pct, d.gross_margin_pct),
    initial_customers: num(a.initial_customers, d.initial_customers),
    new_customers_m1: num(a.new_customers_m1, d.new_customers_m1),
    monthly_growth_rate_pct: num(a.monthly_growth_rate_pct, d.monthly_growth_rate_pct),
    monthly_churn_rate_pct: num(a.monthly_churn_rate_pct ?? a.monthly_churn_rate, d.monthly_churn_rate_pct),
    monthly_opex: num(a.monthly_opex ?? cacToOpex, d.monthly_opex),
    horizon_months: Math.min(120, Math.max(6, num(a.horizon_months, d.horizon_months))),
  };
}

function buildScenario(a: FinancialAssumptions, def: typeof SCENARIO_DEFS[number]): Scenario {
  const horizon = a.horizon_months;
  const gm = Math.min(1, Math.max(0, a.gross_margin_pct / 100));
  const growth = a.monthly_growth_rate_pct / 100;
  const churn = Math.min(1, Math.max(0, (a.monthly_churn_rate_pct / 100) * def.churnMult));
  const newM1 = a.new_customers_m1 * def.acqMult;

  const months: MonthRow[] = [];
  let totalCustomers = a.initial_customers;
  let cash = a.starting_cash;
  let minCash = cash;
  let breakeven: number | null = null;

  for (let m = 1; m <= horizon; m++) {
    const newCustomers = round(newM1 * Math.pow(1 + growth, m - 1));
    const churned = round(totalCustomers * churn);
    totalCustomers = Math.max(0, totalCustomers + newCustomers - churned);
    const mrr = round(totalCustomers * a.arpu_monthly);
    const revenue = mrr;
    const cogs = round(revenue * (1 - gm));
    const opex = round(a.monthly_opex);
    const netBurn = opex + cogs - revenue;
    cash = round(cash - netBurn);
    minCash = Math.min(minCash, cash);
    if (breakeven === null && netBurn <= 0 && revenue > 0) breakeven = m;
    months.push({
      month: m,
      new_customers: newCustomers,
      churned_customers: churned,
      total_customers: totalCustomers,
      mrr,
      revenue,
      cogs,
      gross_margin_pct: round(a.gross_margin_pct),
      opex,
      net_burn: netBurn,
      cash_remaining: cash,
      runway_months: netBurn > 0 ? round2(cash / netBurn) : null,
    });
  }

  const yearSummaries: YearSummary[] = [];
  for (let y = 1; y * 12 <= horizon; y++) {
    const slice = months.slice((y - 1) * 12, y * 12);
    if (slice.length === 0) break;
    const last = slice[slice.length - 1];
    const total_revenue = slice.reduce((s, r) => s + r.revenue, 0);
    const total_costs = slice.reduce((s, r) => s + r.cogs + r.opex, 0);
    yearSummaries.push({
      year: y,
      arr: round(last.mrr * 12),
      total_revenue,
      total_costs,
      net_income: total_revenue - total_costs,
      ending_customers: last.total_customers,
      ending_cash: last.cash_remaining,
    });
  }

  return {
    key: def.key,
    label: def.label,
    monthly_projections: months,
    year_summaries: yearSummaries,
    breakeven_month: breakeven,
    peak_cash_need: Math.max(0, -minCash),
    ending_cash: months.length ? months[months.length - 1].cash_remaining : a.starting_cash,
  };
}

/** Recompute the full model from editable assumptions. Deterministic + pure. */
export function computeFinancialModel(input: Partial<FinancialAssumptions>): FinancialModel {
  const assumptions = coerceAssumptions(input);
  return {
    assumptions,
    scenarios: SCENARIO_DEFS.map((def) => buildScenario(assumptions, def)),
    generated_by: 'engine',
  };
}
