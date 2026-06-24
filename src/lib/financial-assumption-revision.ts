/**
 * Phase B (financial coherence): close the watcher → financial loop. A watcher
 * signal (e.g. a competitor's price) can PROPOSE a revision to a financial
 * assumption; the founder edits/approves it from the inbox, and the model
 * recomputes. Both halves live here as PURE, testable functions:
 *   - applyRevisionToAssumptions: validate + clamp one field (used by the executor)
 *   - proposeArpuRevisionFromAlert: the conservative producer (used on signal accept)
 */
import type { FinancialAssumptions } from './financial-projection';
import { parseMonthlyPrice } from './financial-provenance';

export type RevisableField = Exclude<keyof FinancialAssumptions, 'currency'>;

/** [min, max] sanity bounds per numeric assumption — keeps a bad proposal from
 *  producing an absurd model on apply. */
const BOUNDS: Record<RevisableField, [number, number]> = {
  starting_cash: [0, 1e12],
  monthly_opex: [0, 1e9],
  arpu_monthly: [0, 1e7],
  gross_margin_pct: [0, 100],
  initial_customers: [0, 1e9],
  new_customers_m1: [0, 1e9],
  monthly_growth_rate_pct: [-100, 1000],
  monthly_churn_rate_pct: [0, 100],
  horizon_months: [6, 120],
};

export function isRevisableField(f: unknown): f is RevisableField {
  return typeof f === 'string' && Object.prototype.hasOwnProperty.call(BOUNDS, f);
}

/**
 * Apply one assumption revision. Returns a new assumptions object (validated +
 * clamped to bounds) or null when the field/value is invalid.
 */
export function applyRevisionToAssumptions(
  current: FinancialAssumptions,
  field: string,
  value: unknown,
): FinancialAssumptions | null {
  if (!isRevisableField(field)) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = BOUNDS[field];
  return { ...current, [field]: Math.min(hi, Math.max(lo, n)) };
}

export interface AssumptionRevisionProposal {
  field: RevisableField;
  value: number;
  rationale: string;
}

/**
 * Conservative producer: only when an accepted COMPETITOR signal carries a clean
 * monthly price that MATERIALLY (>15%) differs from the current ARPU do we
 * propose reviewing ARPU. The proposed value is a starting suggestion — the
 * founder edits or dismisses it. Returns null otherwise (no inbox noise).
 */
export function proposeArpuRevisionFromAlert(
  alert: { kind?: string | null; node_type?: string | null; headline?: string | null; body?: string | null },
  currentArpu: number,
): AssumptionRevisionProposal | null {
  const kind = String(alert.kind || alert.node_type || '').toLowerCase();
  if (!/competitor|pricing|price/.test(kind)) return null;
  if (!Number.isFinite(currentArpu) || currentArpu <= 0) return null;
  const text = [alert.headline, alert.body].filter(Boolean).join('  ');
  const priced = parseMonthlyPrice(text);
  if (!priced || priced.monthly <= 0) return null;
  const delta = Math.abs(priced.monthly - currentArpu) / currentArpu;
  if (delta < 0.15) return null; // immaterial — skip
  return {
    field: 'arpu_monthly',
    value: priced.monthly,
    rationale: `A watcher flagged a competitor at ${priced.label}, vs your ARPU assumption of ${currentArpu}. Review whether your pricing assumption still holds — edit the value before applying.`,
  };
}
