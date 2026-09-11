/**
 * Finance department — runway policy.
 *
 * Single source of truth for "how many months of runway do we have?" The
 * Finance department page reads this; the Co-pilot's fundraising prompts read
 * this; downstream "raise alerts" read this. Change the formula here and the
 * whole product follows.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DECISION POINT — founder owns this.
 *
 * Pick a formula. Tradeoffs:
 *
 *   1. NAIVE LINEAR  — cash / burn
 *      • Pros: simple, transparent, matches investor mental model.
 *      • Cons: ignores hiring plans, revenue ramp, seasonal burn.
 *      • Best for: pre-revenue startups, first 12 months.
 *
 *   2. CONSERVATIVE  — cash / (burn * (1 + monthly_burn_growth))^n
 *      • Pros: assumes burn grows N% / month (common with hiring).
 *      • Cons: needs a growth assumption (you pick: 5%? 10%?).
 *      • Best for: teams actively hiring, mid-stage seed.
 *
 *   3. NET OF REVENUE — cash / (burn - expected_monthly_revenue)
 *      • Pros: reflects post-revenue reality (default at Series A+).
 *      • Cons: revenue projections are usually wrong; can give false comfort.
 *      • Best for: post-PMF teams with a stable run-rate.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *
 * TODO — implement your preferred policy below. Should return:
 *   • a number (months of runway) when computable
 *   • null when not computable (missing data or zero/negative burn)
 *
 * Keep it under 10 lines. Add a short "// Why" comment naming the policy.
 */

export function computeRunwayMonths(
  cashOnHand: number | null | undefined,
  monthlyBurn: number | null | undefined,
): number | null {
  // TODO(founder): pick a runway policy — see the doc block above.
  //
  // Naive linear placeholder so the page renders during Phase 1.
  // Replace with your chosen formula before relying on the pill for decisions.
  if (cashOnHand == null || monthlyBurn == null || monthlyBurn <= 0) return null;
  return cashOnHand / monthlyBurn;
}
