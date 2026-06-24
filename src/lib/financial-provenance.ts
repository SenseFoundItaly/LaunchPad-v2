/**
 * Seed financial assumptions from the project's OWN established evidence instead
 * of bare defaults — and tag each derived field with where it came from. Closes
 * the coherence gap where the financial model used €29 default ARPU while the
 * Idea Canvas said "€49 per practitioner per month".
 *
 * Conservative by design: we only derive HIGH-CONFIDENCE signals (per-unit
 * pricing → ARPU + currency). Customer counts / opex are left to the founder or
 * defaults — deriving them from market sizing is error-prone, and a wrong seed
 * is worse than a neutral default. Pure + dependency-light (parseAmount only).
 */
import type { FinancialAssumptions } from './financial-projection';
import { parseAmount } from './market-size-coherence';

export interface DerivedAssumptions {
  /** Subset of assumptions we could ground in project evidence. */
  assumptions: Partial<FinancialAssumptions>;
  /** Per-field human label of the source, e.g. "Idea Canvas — €49 monthly price". */
  provenance: Record<string, string>;
}

const CURRENCY: Record<string, string> = { '€': 'EUR', $: 'USD', '£': 'GBP' };

/**
 * Extract a per-unit price (→ monthly ARPU) + currency from pricing prose.
 * Requires a cadence/per-unit cue near the amount so we don't mistake a
 * market-size figure ("$10M ARR") for a seat price. Exported for reuse by the
 * watcher→assumption producer (Phase B).
 */
export function parseMonthlyPrice(text: string): { monthly: number; currency?: string; label: string } | null {
  if (!text) return null;
  const re = /([€$£])\s?(\d[\d,]*(?:\.\d+)?)\s*([a-z/ .-]{0,40})/gi;
  for (const m of text.matchAll(re)) {
    const sym = m[1];
    const amount = parseAmount(`${sym}${m[2]}`);
    if (amount == null || amount <= 0) continue;
    const tail = (m[3] || '').toLowerCase();
    const near = text.slice(m.index, (m.index ?? 0) + 70).toLowerCase();
    const perUnit = /\b(per\s+(month|seat|user|practitioner|customer|year|member)|\/\s?(mo|month|yr|year|seat|user)|monthly|annually|per annum|yearly)\b/.test(tail)
      || /\b(seat|per[- ]?seat|per user|per practitioner|\/mo|\/month)\b/.test(near);
    if (!perUnit) continue;
    const annual = /\b(per\s+year|per annum|\/\s?yr|\/\s?year|yearly)\b/.test(tail);
    const monthly = annual ? Math.round(amount / 12) : Math.round(amount);
    return { monthly, currency: CURRENCY[sym], label: `${sym}${m[2]} ${annual ? 'annual price ÷ 12' : 'monthly price'}` };
  }
  return null;
}

/**
 * Derive what we can from the project. `canvas` = idea_canvas row;
 * `research` = research row (market_size used only for an informational note).
 */
export function deriveAssumptionsFromProject(input: {
  canvas?: Record<string, unknown> | null;
  research?: Record<string, unknown> | null;
}): DerivedAssumptions {
  const assumptions: Partial<FinancialAssumptions> = {};
  const provenance: Record<string, string> = {};
  const c = input.canvas || {};

  const pricingText = ['business_model', 'revenue_streams', 'value_proposition']
    .map((k) => c[k])
    .filter((v): v is string => typeof v === 'string')
    .join('  ·  ');

  const priced = parseMonthlyPrice(pricingText);
  if (priced) {
    assumptions.arpu_monthly = priced.monthly;
    provenance.arpu_monthly = `Idea Canvas — ${priced.label}`;
    if (priced.currency) {
      assumptions.currency = priced.currency;
      provenance.currency = 'Idea Canvas — pricing';
    }
  }

  return { assumptions, provenance };
}
