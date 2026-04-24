import { get } from '@/lib/db';

/**
 * Credits — a UX abstraction over project_budgets.
 *
 * Real LLM cost continues to be tracked dollar-precise in llm_usage_logs and
 * project_budgets.current_llm_usd. Credits are a friendlier number for the
 * founder to look at: "you have 12 credits this month" beats "$0.43 of $0.60".
 *
 * MVP economics:
 *   - 1 task = 1 credit = $0.05 of headroom against the monthly LLM cap.
 *   - The badge in TopBar also shows "today X/3" — a soft daily cap surfaced
 *     for psychological-anchoring purposes (display only; not enforced — the
 *     monthly cap_llm_usd is the only hard limit).
 *
 * When to enforce: persistArtifact's task case + the create_task tool both
 * call getCreditsRemaining() before writing. If it returns 0, the write is
 * skipped and a friendly error surfaces instead of a silently-dropped task.
 */

export const CREDITS_PER_TASK_USD = 0.05;
export const FREE_DAILY_TASKS = 3;

interface BudgetRow {
  cap_llm_usd: number;
  current_llm_usd: number;
}

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getCurrentBudget(projectId: string): BudgetRow | undefined {
  return get<BudgetRow>(
    `SELECT cap_llm_usd, current_llm_usd
     FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId,
    currentPeriodMonth(),
  );
}

export interface CreditsSnapshot {
  remaining: number;
  used_today: number;
  daily_cap: number;
  cap_usd: number;
  used_usd: number;
  period_month: string;
}

export function getCreditsSnapshot(projectId: string): CreditsSnapshot {
  const periodMonth = currentPeriodMonth();
  const budget = getCurrentBudget(projectId);
  // No row yet this month → fall back to the schema default cap so the badge
  // still shows a number rather than 0. The first cost-meter call this month
  // will create the row at the same default and persist correctly.
  const capUsd = budget?.cap_llm_usd ?? 0;
  const usedUsd = budget?.current_llm_usd ?? 0;
  const remainingUsd = Math.max(0, capUsd - usedUsd);
  const remaining = Math.floor(remainingUsd / CREDITS_PER_TASK_USD);

  const todayRow = get<{ n: number }>(
    `SELECT COUNT(*) as n FROM pending_actions
     WHERE project_id = ?
       AND action_type = 'task'
       AND created_at >= date('now')`,
    projectId,
  );
  const usedToday = todayRow?.n ?? 0;

  return {
    remaining,
    used_today: usedToday,
    daily_cap: FREE_DAILY_TASKS,
    cap_usd: capUsd,
    used_usd: usedUsd,
    period_month: periodMonth,
  };
}

export function getCreditsRemaining(projectId: string): number {
  return getCreditsSnapshot(projectId).remaining;
}
