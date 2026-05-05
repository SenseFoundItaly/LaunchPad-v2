import { get } from '@/lib/db';

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

/** Default credits-per-dollar when no budget row exists yet. */
const DEFAULT_CREDITS_PER_DOLLAR = 200;
const DEFAULT_CAP_CREDITS = 100;

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
