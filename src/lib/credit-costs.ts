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
 * are per-user, shared across all their projects).
 *
 * PRICING (founder decision 2026-06-16): 3× markup over raw LLM cost. The debit
 * is credits = cost_usd × (cap_credits / cap_llm_usd), so pairing 100 credits
 * with a $0.333 cost ceiling makes creditsPerDollar = 300 → 1 credit ≈ $0.0033
 * of LLM spend, i.e. the founder's 100-credit pool covers ~$0.33 of real cost
 * and the rest is gross margin (~67%). Was $1.00 (pass-through, 0 margin).
 *
 * These are the FALLBACKS for users with no user_budgets row; EXISTING rows
 * keep their stored cap_llm_usd until migrated (see the companion DB update).
 */
export const USER_MONTHLY_CREDITS = 100;
export const USER_MONTHLY_LLM_USD = 0.333;
export const USER_MONTHLY_WARN_LLM_USD = 0.267;

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
