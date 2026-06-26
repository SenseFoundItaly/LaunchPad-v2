/**
 * Credit cost constants — client-safe (NO db / server imports), so client
 * components can display costs without bundling server code. `@/lib/credits`
 * re-exports these and owns the actual debit logic.
 */

/**
 * Flat credit cost to APPLY a knowledge proposal (insight / entity /
 * comparison / metric / fact) into project intelligence. Charged once, on the
 * pending→applied transition — never on re-apply or on dismiss.
 *
 * Founder directive 2026-06-17 (item 14.2): the analysis that PRODUCED the
 * proposal already paid its LLM cost, so the approval itself is just a gating
 * click and must stay cheap — "approval shouldn't exceed 0.25–0.5 credits" — or
 * a graph with many insights becomes unsustainable. Was 2 (which double-charged
 * on top of the generation cost). Fractional debits are supported (debitCredits
 * converts credits→USD with no integer rounding).
 */
export const KNOWLEDGE_APPLY_CREDITS = 0.5;

/**
 * Flat credit cost to AUDIT one uploaded document — run the extraction passes
 * (entities / canvas / monitors) and ingest it. Founder decision 2026-06-14:
 * documents are priced per-document at a flat rate (complexity-independent);
 * applying the entities the audit surfaces is then FREE (you already paid to
 * audit the doc). Charged once per ingested document in the knowledge upload
 * route when ?audit_charge=1 is set.
 */
export const DOCUMENT_AUDIT_CREDITS = 3;

/**
 * Default monthly credit pool per USER (founder decision 2026-06-14: credits
 * are per-user, shared across ALL their projects — debits resolve the project's
 * owner first, so spend on any project draws the same pool).
 *
 * UNIT (founder decision 2026-06-26): a generous, cost-true free pool —
 * **50 credits ≈ $10 of real LLM / month**, so **1 credit ≈ $0.20 of LLM cost**
 * (creditsPerDollar = 50 / 10 = 5). The debit is credits = cost_usd ×
 * (cap_credits / cap_llm_usd). A typical chat turn (~$0.14) ≈ 0.7 cr and a heavy
 * skill (~$0.46) ≈ 2.3 cr, so the $10 pool covers ~50–90 messages or ~20 skill
 * runs/month. This replaces the old markup-baked unit (100 cr over $0.333 =
 * 300 cr/$), which made one workflow exhaust the month and drove the "credits
 * scaled randomly / run out instantly" complaint. The 3× sale markup, if/when
 * billing returns, lives in the SALE price — NOT in this cost-true unit.
 *
 * These are the seed values for NEW monthly rows (cost-meter upsert) AND the
 * fallback ratio for users with no row; EXISTING rows are rebased to match via
 * scripts/rebase-credit-pool.mjs. Credits are currently HIDDEN ([[HIDE_CREDITS]])
 * and unenforced (CREDITS_HARD_STOP unset), so this is the internal accounting
 * basis, not a founder-facing charge.
 */
export const USER_MONTHLY_CREDITS = 50;
export const USER_MONTHLY_LLM_USD = 10.0;
export const USER_MONTHLY_WARN_LLM_USD = 8.0;

/**
 * Hide ALL founder-facing credit UI (badge, cost chips, apply/skill/doc prices)
 * AND the agent's verbal credit-cost mentions — billing-free mode. Build-time
 * NEXT_PUBLIC so client components inline it. Set NEXT_PUBLIC_HIDE_CREDITS=1
 * alongside unsetting CREDITS_HARD_STOP; unset both to bring the billing UI back.
 * The dedicated /usage page is intentionally NOT gated (spend analytics, not a
 * charge surface).
 */
export const HIDE_CREDITS = process.env.NEXT_PUBLIC_HIDE_CREDITS === '1';

/**
 * Credits per USD of LLM cost — the conversion the debit math uses (cap_credits
 * / cap_llm_usd). The DEFAULT ratio (50 / 10 = 5) is used for ESTIMATES; the
 * actual per-user debit (and A2a's displayed actual) uses the user's own stored
 * ratio. 5 → 1 credit ≈ $0.20 of LLM spend (cost-true, no markup baked in).
 */
export const CREDITS_PER_DOLLAR = USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD;

/** Convert an LLM cost in USD to a founder-facing credit estimate (rounded). */
export function creditsFromUsd(usd: number): number {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return 0;
  const c = usd * CREDITS_PER_DOLLAR;
  return c >= 1 ? Math.round(c) : Math.round(c * 10) / 10;
}

/** Median of a numeric list (ignores non-finite). null when empty. */
export function median(nums: number[]): number | null {
  const xs = nums.filter((n) => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/**
 * A2a (copilot-sota): format the ACTUAL metered credit cost of one chat message
 * for display under the message. The real per-message cost is computed in
 * useChat (from the `done` SSE usage event) and was previously dropped on the
 * floor — showing it is the founder's loudest-pain ("credits feel random") fix:
 * the true number, after the fact, beats a fictional pre-quote.
 *
 * Returns null (render nothing) for: missing cost (historical / in-flight
 * messages), non-finite, or non-positive — never "undefined cr" / "NaN cr" / "0 cr".
 * >=1 credit rounds to an integer; sub-1 shows one decimal (e.g. "0.5 cr").
 */
export function formatMessageCredits(
  info: { credits?: number } | null | undefined,
): string | null {
  const c = info?.credits;
  if (typeof c !== 'number' || !Number.isFinite(c) || c <= 0) return null;
  const n = c >= 1 ? Math.round(c) : Math.round(c * 10) / 10;
  return `${n} cr`;
}
