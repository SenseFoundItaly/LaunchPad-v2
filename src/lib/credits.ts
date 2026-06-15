import { get, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { upsertMonthlyBudget, upsertUserMonthlyBudget, ownerUserId } from '@/lib/cost-meter';
import { USER_MONTHLY_CREDITS, USER_MONTHLY_LLM_USD } from '@/lib/credit-costs';

// Cost constants live in a client-safe module (no db imports) so client
// components can read them too; re-exported here so server callers keep
// importing from '@/lib/credits'.
export { KNOWLEDGE_APPLY_CREDITS, DOCUMENT_AUDIT_CREDITS } from '@/lib/credit-costs';

/**
 * Credits — a UX abstraction over the per-USER monthly pool (user_budgets).
 *
 * Founder decision 2026-06-14: credits are PER USER, shared across all their
 * projects — not per project. Every project resolves its owner_user_id and
 * reads/writes that user's pool. Real LLM cost is still tracked dollar-precise
 * per project in llm_usage_logs + project_budgets (the usage page); credits are
 * the friendlier number ("72/100 credits this month").
 *
 * Economics (DB-driven, on the user_budgets row):
 *   - cap_credits default 100 over cap_llm_usd default 1.00
 *   - creditsPerDollar = cap_credits / cap_llm_usd  (→ 100, 1 credit ≈ $0.01)
 *   - credits_used = round(current_llm_usd * creditsPerDollar)
 *   - remaining = max(0, cap_credits - credits_used)
 *
 * The badge also shows "today X/3" — a soft daily anchor (display only). The
 * hard limit is the user's monthly cap_llm_usd.
 */

export const FREE_DAILY_TASKS = 3;

/** Fallbacks when no user_budgets row exists yet (credits shown from day 1).
 * 100 credits over $1.00 → 100 credits per $1 → 1 credit ≈ $0.01 of LLM spend. */
const DEFAULT_CREDITS_PER_DOLLAR = 100;
const DEFAULT_CAP_CREDITS = USER_MONTHLY_CREDITS;

interface BudgetRow {
  cap_llm_usd: number;
  current_llm_usd: number;
  cap_credits: number;
}

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Read a USER's current-month pool row (the authoritative credit source). */
async function getUserBudget(userId: string): Promise<BudgetRow | undefined> {
  return get<BudgetRow>(
    `SELECT cap_llm_usd, current_llm_usd, cap_credits
     FROM user_budgets
     WHERE user_id = ? AND period_month = ?`,
    userId,
    currentPeriodMonth(),
  );
}

/**
 * Convert a USD amount to credits given a project's cap configuration.
 * Exported so the chat page can compute per-message credit costs client-side.
 */
export function usdToCredits(usd: number, capUsd: number, capCredits: number): number {
  if (capUsd <= 0) return 0;
  const creditsPerDollar = capCredits / capUsd;
  return Math.round(usd * creditsPerDollar);
}

export interface CreditsSnapshot {
  remaining: number;
  total: number;
  credits_used: number;
  used_today: number;
  daily_cap: number;
  cap_usd: number;
  used_usd: number;
  period_month: string;
}

/**
 * Snapshot of the credit pool for whoever OWNS this project. Resolves
 * owner_user_id and reads user_budgets, so any of the owner's projects returns
 * the same shared pool. Falls back to the per-user defaults (100 credits, $0
 * spent) when no row exists yet — the badge shows 100/100 from day one.
 */
export async function getCreditsSnapshot(projectId: string): Promise<CreditsSnapshot> {
  const periodMonth = currentPeriodMonth();
  const owner = await ownerUserId(projectId);
  const budget = owner ? await getUserBudget(owner) : undefined;
  const capUsd = budget?.cap_llm_usd ?? 0;
  const usedUsd = budget?.current_llm_usd ?? 0;
  const capCredits = budget?.cap_credits ?? DEFAULT_CAP_CREDITS;

  const creditsPerDollar = capUsd > 0 ? capCredits / capUsd : DEFAULT_CREDITS_PER_DOLLAR;
  const creditsUsed = Math.round(usedUsd * creditsPerDollar);
  const remaining = Math.max(0, capCredits - creditsUsed);

  // Soft "today" anchor — count task actions across ALL the owner's projects
  // (the pool is shared), not just this one.
  const todayRow = owner
    ? await get<{ n: number }>(
        `SELECT COUNT(*) as n FROM pending_actions
         WHERE project_id IN (SELECT id FROM projects WHERE owner_user_id = ?)
           AND action_type = 'task'
           AND created_at >= CURRENT_DATE`,
        owner,
      )
    : undefined;
  const usedToday = todayRow?.n ?? 0;

  return {
    remaining,
    total: capCredits,
    credits_used: creditsUsed,
    used_today: usedToday,
    daily_cap: FREE_DAILY_TASKS,
    cap_usd: capUsd,
    used_usd: usedUsd,
    period_month: periodMonth,
  };
}

export async function getCreditsRemaining(projectId: string): Promise<number> {
  return (await getCreditsSnapshot(projectId)).remaining;
}

/** Snapshot keyed directly by user (no project context). Same pool as
 *  getCreditsSnapshot, used by user-level endpoints like /api/user/credits. */
export async function getUserCreditsSnapshot(userId: string): Promise<CreditsSnapshot> {
  const periodMonth = currentPeriodMonth();
  const budget = await getUserBudget(userId);
  const capUsd = budget?.cap_llm_usd ?? 0;
  const usedUsd = budget?.current_llm_usd ?? 0;
  const capCredits = budget?.cap_credits ?? DEFAULT_CAP_CREDITS;
  const creditsPerDollar = capUsd > 0 ? capCredits / capUsd : DEFAULT_CREDITS_PER_DOLLAR;
  const creditsUsed = Math.round(usedUsd * creditsPerDollar);
  const remaining = Math.max(0, capCredits - creditsUsed);

  const todayRow = await get<{ n: number }>(
    `SELECT COUNT(*) as n FROM pending_actions
     WHERE project_id IN (SELECT id FROM projects WHERE owner_user_id = ?)
       AND action_type = 'task'
       AND created_at >= CURRENT_DATE`,
    userId,
  );

  return {
    remaining,
    total: capCredits,
    credits_used: creditsUsed,
    used_today: todayRow?.n ?? 0,
    daily_cap: FREE_DAILY_TASKS,
    cap_usd: capUsd,
    used_usd: usedUsd,
    period_month: periodMonth,
  };
}

/**
 * Debit a flat number of CREDITS for a project action, from the project
 * OWNER's per-user pool (credits are per-user as of 2026-06-14).
 *
 * The USD-equivalent (`credits / creditsPerDollar`, at the user pool's ratio)
 * is accumulated onto BOTH ledgers:
 *   - user_budgets  — the authoritative pool the badge/cap read (per user);
 *   - project_budgets + an llm_usage_logs mirror row — so the per-project usage
 *     page still itemizes the charge and the reconciliation invariant
 *     (SUM(project logs) == project_budgets.current_llm_usd) keeps holding.
 *
 * Unlike the old per-project behavior, this charges from day one (the upsert
 * seeds the pool row) rather than waiting for a first LLM call. Idempotency
 * (don't debit on re-apply) is the CALLER's responsibility.
 *
 * `step` is the audit label this charge appears under on the usage page (e.g.
 * 'knowledge_apply', 'document_audit'). Best-effort: returns the USD debited
 * (0 when the project has no resolvable owner — unmetered).
 */
export async function debitCredits(
  projectId: string,
  credits: number,
  step = 'credit_debit',
): Promise<number> {
  if (credits <= 0) return 0;
  const owner = await ownerUserId(projectId);
  if (!owner) return 0; // orphan project — no pool to charge

  // Ratio from the USER pool (or per-user defaults). 100 credits / $1 → $0.01.
  const budget = await getUserBudget(owner);
  const capCredits = budget?.cap_credits ?? DEFAULT_CAP_CREDITS;
  const capUsd = budget?.cap_llm_usd ?? USER_MONTHLY_LLM_USD;
  const creditsPerDollar = capUsd > 0 ? capCredits / capUsd : DEFAULT_CREDITS_PER_DOLLAR;
  if (creditsPerDollar <= 0) return 0;
  const usdDelta = credits / creditsPerDollar;

  // Authoritative per-user pool (what the badge + cap read).
  await upsertUserMonthlyBudget(owner, currentPeriodMonth(), usdDelta);
  // Per-project $ accumulator — keeps the usage page total and the
  // SUM(logs)==current reconciliation invariant correct alongside the mirror.
  await upsertMonthlyBudget(projectId, currentPeriodMonth(), usdDelta);

  // Mirror the debit into llm_usage_logs so the usage/audit page itemizes
  // credit spend (knowledge applies, document audits) alongside LLM token
  // spend. provider='internal' / model='credit' marks it as a flat charge, not
  // a token-metered model call. Deliberately a direct INSERT, not recordUsage()
  // (which would re-accumulate the budgets and emit a bogus Langfuse row).
  // Best-effort — the debit already landed; a failed log row must never throw.
  try {
    await run(
      `INSERT INTO llm_usage_logs
         (id, project_id, skill_id, step, provider, model,
          input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
          total_cost_usd, latency_ms)
       VALUES (?, ?, NULL, ?, 'internal', 'credit', 0, 0, 0, 0, ?, 0)`,
      generateId('llmlg'),
      projectId,
      step,
      usdDelta,
    );
  } catch (err) {
    console.warn('[debitCredits] usage-log mirror failed (non-fatal):', (err as Error).message);
  }

  return usdDelta;
}
