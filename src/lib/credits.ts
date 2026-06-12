import { get } from '@/lib/db';
import { upsertMonthlyBudget } from '@/lib/cost-meter';

/**
 * Flat credit cost to APPLY a knowledge proposal (insight / entity /
 * comparison / metric / fact) into project intelligence. Charged once, on the
 * pending→applied transition — never on re-apply or on dismiss. Founder
 * directive 2026-06-11: surfacing knowledge is free; APPLYING it costs 2.
 */
export const KNOWLEDGE_APPLY_CREDITS = 2;

/**
 * Credits — a UX abstraction over project_budgets.
 *
 * Real LLM cost continues to be tracked dollar-precise in llm_usage_logs and
 * project_budgets.current_llm_usd. Credits are a friendlier number for the
 * founder to look at: "you have 72/100 credits this month" beats "$0.43 of $0.60".
 *
 * Economics are now DB-driven:
 *   - cap_credits lives on the project_budgets row (default 100)
 *   - creditsPerDollar = cap_credits / cap_llm_usd
 *   - credits_used = round(current_llm_usd * creditsPerDollar)
 *   - remaining = max(0, cap_credits - credits_used)
 *
 * The badge in TopBar also shows "today X/3" — a soft daily cap surfaced
 * for psychological-anchoring purposes (display only; not enforced — the
 * monthly cap_llm_usd is the only hard limit).
 */

export const FREE_DAILY_TASKS = 3;

/** Default credits-per-dollar when no budget row exists yet.
 * Schema is the source of truth: db/schema.sql sets cap_credits=500 over
 * cap_llm_usd=5.00 → 100 credits per $1 → 1 credit = $0.01 of LLM spend.
 */
const DEFAULT_CREDITS_PER_DOLLAR = 100;
const DEFAULT_CAP_CREDITS = 500;

interface BudgetRow {
  cap_llm_usd: number;
  current_llm_usd: number;
  cap_credits: number;
}

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getCurrentBudget(projectId: string): Promise<BudgetRow | undefined> {
  return get<BudgetRow>(
    `SELECT cap_llm_usd, current_llm_usd, cap_credits
     FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId,
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

export async function getCreditsSnapshot(projectId: string): Promise<CreditsSnapshot> {
  const periodMonth = currentPeriodMonth();
  const budget = await getCurrentBudget(projectId);
  const capUsd = budget?.cap_llm_usd ?? 0;
  const usedUsd = budget?.current_llm_usd ?? 0;
  const capCredits = budget?.cap_credits ?? DEFAULT_CAP_CREDITS;

  const creditsPerDollar = capUsd > 0 ? capCredits / capUsd : DEFAULT_CREDITS_PER_DOLLAR;
  const creditsUsed = Math.round(usedUsd * creditsPerDollar);
  const remaining = Math.max(0, capCredits - creditsUsed);

  const todayRow = await get<{ n: number }>(
    `SELECT COUNT(*) as n FROM pending_actions
     WHERE project_id = ?
       AND action_type = 'task'
       AND created_at >= CURRENT_DATE`,
    projectId,
  );
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

/**
 * Debit a flat number of CREDITS from a project's monthly budget.
 *
 * Credits are a UX skin over `project_budgets.current_llm_usd` (remaining =
 * cap_credits - round(current_llm_usd * creditsPerDollar)). There is no
 * separate credit ledger column, so a debit is implemented as an increment of
 * current_llm_usd by the USD-equivalent of `credits` at the project's own
 * cap ratio. We reuse upsertMonthlyBudget (the same accumulator the LLM
 * cost-meter uses), keeping one accounting path.
 *
 * Used by the knowledge-apply path (server-side, on pending→applied) so the
 * debit can't be skipped by a client that never fires it. Idempotency (don't
 * debit on re-apply) is the CALLER's responsibility — only call this when the
 * row actually transitions into 'applied'.
 *
 * Best-effort: returns the USD amount debited (0 when no budget row / cap is
 * configured yet — credits are unbounded then, so there's nothing to charge).
 */
export async function debitCredits(projectId: string, credits: number): Promise<number> {
  if (credits <= 0) return 0;
  const budget = await getCurrentBudget(projectId);
  // No budget row or zero cap → credits aren't being metered for this project
  // yet; nothing to debit against. (A row is created lazily on first LLM call.)
  if (!budget || budget.cap_llm_usd <= 0) return 0;
  const capCredits = budget.cap_credits ?? DEFAULT_CAP_CREDITS;
  const creditsPerDollar = capCredits / budget.cap_llm_usd;
  if (creditsPerDollar <= 0) return 0;
  const usdDelta = credits / creditsPerDollar;
  await upsertMonthlyBudget(projectId, currentPeriodMonth(), usdDelta);
  return usdDelta;
}
