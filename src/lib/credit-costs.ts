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
