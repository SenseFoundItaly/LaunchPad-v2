/**
 * Cost Meter — observe-mode usage capture for the <€0.25/user/month L1
 * promise from the SenseFound BM doc.
 *
 * Every caller of runAgent() passes the returned usage to recordUsage() with
 * the projectId. We log one row per agent call to llm_usage_logs and upsert
 * the monthly total into project_budgets. If the monthly total crosses the
 * warn threshold and no warning alert has been issued yet this month, we
 * insert a budget_warning alert.
 *
 * Phase 0 is observe + warn only (per locked decision in plan §10): no
 * hard-block on cap. Phase 1 will layer enforcement on top.
 */

import type { Usage } from '@mariozechner/pi-ai';
import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { logToLangfuse, estimateCost, type TelemetryContext } from '@/lib/telemetry';
import { pickModel, type TaskLabel } from '@/lib/llm/router';
import {
  USER_MONTHLY_CREDITS,
  USER_MONTHLY_LLM_USD,
  USER_MONTHLY_WARN_LLM_USD,
} from '@/lib/credit-costs';

export interface RecordUsageInput {
  project_id: string;
  /** Short label for which skill or monitor caused this call. */
  skill_id?: string;
  /** Freeform step label (e.g. 'cron.ecosystem.competitors'). */
  step?: string;
  provider: string;
  model: string;
  usage: Usage | undefined;
  /** Wall-clock ms from request start to response end. Optional. */
  latency_ms?: number;
  /** When true, still log the call (llm_usage_logs + Langfuse) but do NOT debit
   *  the per-user credit pool. Used for runs that produced no usable deliverable
   *  (clarification-only skill output) so a founder is never charged for nothing. */
  skip_credit_debit?: boolean;
}

export interface RecordUsageResult {
  log_id: string;
  cost_usd: number;
  total_tokens: number;
  crossed_warn: boolean;
  current_llm_usd: number;
  cap_llm_usd: number;
  credits_used: number;
  credits_remaining: number;
  credits_total: number;
}

/**
 * Record a single Pi Agent call into llm_usage_logs and upsert the monthly
 * budget row. Returns whether this call crossed the warn threshold, so the
 * caller can surface it in the Monday Brief narrative ("your budget for
 * April is at 82%").
 *
 * Safe to call with undefined usage — we no-op in that case rather than
 * throw. This guards the path where Pi Agent emits done without usage.
 */
export async function recordUsage(input: RecordUsageInput): Promise<RecordUsageResult | null> {
  if (!input.usage) return null;

  const costUsd = extractCost(input.usage);
  const inputTokens = extractTokens(input.usage, 'input');
  const outputTokens = extractTokens(input.usage, 'output');
  const cacheCreation = extractTokens(input.usage, 'cacheCreation');
  const cacheRead = extractTokens(input.usage, 'cacheRead');

  const logId = generateId('llmlg');
  await run(
    `INSERT INTO llm_usage_logs
       (id, project_id, skill_id, step, provider, model,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
        total_cost_usd, latency_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    logId,
    input.project_id,
    input.skill_id || null,
    input.step || null,
    input.provider,
    input.model,
    inputTokens,
    outputTokens,
    cacheCreation,
    cacheRead,
    costUsd,
    input.latency_ms ?? 0,
  );

  const periodMonth = currentPeriodMonth();
  // Per-project dollar tracking (kept for the usage page); NOT the credit/cap
  // source anymore — credits moved to the per-user pool below.
  await upsertMonthlyBudget(input.project_id, periodMonth, costUsd);

  // Authoritative per-USER pool: resolve the project's owner and accumulate
  // their shared monthly spend. All of a user's projects draw from one pool.
  // Skipped entirely when skip_credit_debit is set — the call is still logged
  // above (and to Langfuse below) for observability, but no credits are charged.
  const owner = input.skip_credit_debit ? null : await ownerUserId(input.project_id);
  const userBudget = owner
    ? await upsertUserMonthlyBudget(owner, periodMonth, costUsd)
    : null;

  const crossedWarn = !!userBudget && didCrossWarn(userBudget, costUsd);
  if (crossedWarn && userBudget) {
    await maybeEmitBudgetWarning(input.project_id, periodMonth, userBudget);
  }

  // Mirror the call into Langfuse so cron/manual monitor runs appear in the
  // same dashboard as chat traces. logToLangfuse lazy-inits the Langfuse
  // client and silently no-ops when LANGFUSE_SECRET_KEY is absent, so this
  // is safe to call unconditionally from local-dev or prod.
  const provider = input.provider as TelemetryContext['provider'];
  try {
    logToLangfuse(
      {
        projectId: input.project_id,
        skillId: input.skill_id,
        step: input.step || 'monitor',
        provider,
        model: input.model,
      },
      {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
      },
      costUsd,
      input.latency_ms ?? 0,
    );
  } catch (err) {
    // Langfuse is best-effort observability; failure must not affect the
    // primary cost-tracking path.
    console.warn('cost-meter → Langfuse failed (non-fatal):', (err as Error).message);
  }

  // Credits + cap come from the USER pool. Fallback to the per-user defaults
  // (100 credits / $1 → 100 credits per $1, 1 credit = $0.01) when there's no
  // row or no resolvable owner — credits are unbounded then.
  const capCredits = userBudget?.cap_credits ?? USER_MONTHLY_CREDITS;
  const capUsd = userBudget?.cap_llm_usd ?? USER_MONTHLY_LLM_USD;
  const currentUserUsd = userBudget?.current_llm_usd ?? costUsd;
  const creditsPerDollar = capUsd > 0 ? capCredits / capUsd : 100;
  const creditsUsedThisCall = Math.round(costUsd * creditsPerDollar);
  const totalCreditsUsed = Math.round(currentUserUsd * creditsPerDollar);
  const creditsRemaining = Math.max(0, capCredits - totalCreditsUsed);

  return {
    log_id: logId,
    cost_usd: costUsd,
    total_tokens: inputTokens + outputTokens,
    crossed_warn: crossedWarn,
    current_llm_usd: currentUserUsd,
    cap_llm_usd: capUsd,
    credits_used: creditsUsedThisCall,
    credits_remaining: creditsRemaining,
    credits_total: capCredits,
  };
}

/**
 * Convenience wrapper for the common `runAgent` → record-usage flow.
 *
 * Encapsulates the 25-line boilerplate that every runAgent caller needs:
 * resolves provider+model from the task label, synthesizes cost.total via
 * estimateCost() when pi-ai didn't report one (mostly direct-Anthropic),
 * fire-and-forget into recordUsage with the right `step` label.
 *
 * Safe to call with undefined usage — no-ops. Never throws (recordUsage's
 * promise rejection is logged but swallowed).
 */
export function recordAgentUsage(opts: {
  project_id: string;
  skill_id?: string;
  step: string;
  task: TaskLabel | string;
  usage: Usage | undefined;
  latency_ms: number;
  /** "Absorb" the cost — still log it (llm_usage_logs + Langfuse), but don't
   *  debit the founder's credits. For system-side niceties they didn't trigger. */
  skip_credit_debit?: boolean;
}): void {
  if (!opts.usage) return;
  const { provider, model } = pickModel(opts.task);
  const u = opts.usage as unknown as {
    cost?: { total?: number };
    input?: number; output?: number;
    input_tokens?: number; output_tokens?: number;
    inputTokens?: number; outputTokens?: number;
  };
  const hasCost = typeof u?.cost?.total === 'number' && u.cost.total > 0;
  const usageToLog = hasCost
    ? opts.usage
    : {
        ...opts.usage,
        cost: {
          total: estimateCost(provider, model, {
            input_tokens: u.input ?? u.inputTokens ?? u.input_tokens ?? 0,
            output_tokens: u.output ?? u.outputTokens ?? u.output_tokens ?? 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          }),
        },
      };
  recordUsage({
    project_id: opts.project_id,
    skill_id: opts.skill_id,
    step: opts.step,
    provider,
    model,
    usage: usageToLog as Usage,
    latency_ms: opts.latency_ms,
    skip_credit_debit: opts.skip_credit_debit,
  }).catch(err =>
    console.warn(`[${opts.step}] recordUsage failed:`, (err as Error).message),
  );
}

// =============================================================================
// Helpers
// =============================================================================

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Is the OWNER of this project over their monthly LLM cap (or manually
 * 'capped')? Credits are per-user now, so the cap binds on the project owner's
 * shared user pool — not the project. Name kept for the unchanged callers
 * (chat, cron, watch, correlator) which only hold a projectId.
 *
 * Returns {capped: false} when there's no owner or no pool row yet this month
 * (cap not binding). Observe-only — callers log and continue; no hard blocking.
 */
export async function isProjectCapped(projectId: string): Promise<{
  capped: boolean;
  currentUsd: number;
  capUsd: number;
  periodMonth: string;
}> {
  const periodMonth = currentPeriodMonth();
  const owner = await ownerUserId(projectId);
  if (!owner) return { capped: false, currentUsd: 0, capUsd: 0, periodMonth };

  const row = (await query<{
    current_llm_usd: number;
    cap_llm_usd: number;
    status: string;
  }>(
    `SELECT current_llm_usd, cap_llm_usd, status
     FROM user_budgets
     WHERE user_id = ? AND period_month = ?`,
    owner,
    periodMonth,
  ))[0];

  if (!row) {
    // No pool row yet this month — not capped.
    return { capped: false, currentUsd: 0, capUsd: 0, periodMonth };
  }

  const capped = row.status === 'capped' || row.current_llm_usd >= row.cap_llm_usd;
  return {
    capped,
    currentUsd: row.current_llm_usd,
    capUsd: row.cap_llm_usd,
    periodMonth,
  };
}

/**
 * Resolve a project's owner (the user whose credit pool it draws from).
 * Returns null for legacy/orphan projects with no owner_user_id — callers
 * then treat the pool as unmetered (no cap, no credits charged).
 */
export async function ownerUserId(projectId: string): Promise<string | null> {
  const row = await get<{ owner_user_id: string | null }>(
    'SELECT owner_user_id FROM projects WHERE id = ?',
    projectId,
  );
  return row?.owner_user_id ?? null;
}

interface BudgetSnapshot {
  id: string;
  current_llm_usd: number;
  warn_llm_usd: number;
  cap_llm_usd: number;
  cap_credits: number;
  status: string;
}

/**
 * Increment a project's monthly budget by `costDelta` USD. Exported so the
 * telemetry-layer logger (`logUsageToDb`) can also accumulate — chat used to
 * write llm_usage_logs without ever updating project_budgets, which
 * undercounted spend by ~4x (see fix 2026-06-04).
 *
 * Idempotent for INSERT (UNIQUE(project_id, period_month)); accumulates on
 * conflict.
 */
export async function upsertMonthlyBudget(
  projectId: string,
  periodMonth: string,
  costDelta: number,
): Promise<BudgetSnapshot> {
  // ON CONFLICT DO UPDATE accumulates current_llm_usd. UNIQUE(project_id,
  // period_month) constraint makes this atomic in PostgreSQL.
  const budgetId = generateId('bud');
  await run(
    `INSERT INTO project_budgets
       (id, project_id, period_month, current_llm_usd, status)
     VALUES (?, ?, ?, ?, 'active')
     ON CONFLICT(project_id, period_month) DO UPDATE SET
       current_llm_usd = project_budgets.current_llm_usd + excluded.current_llm_usd,
       updated_at = CURRENT_TIMESTAMP`,
    budgetId,
    projectId,
    periodMonth,
    costDelta,
  );

  const rows = await query<BudgetSnapshot>(
    `SELECT id, current_llm_usd, warn_llm_usd, cap_llm_usd, cap_credits, status
     FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId, periodMonth,
  );
  return rows[0];
}

/**
 * Increment a USER's monthly pool by `costDelta` USD — the AUTHORITATIVE credit
 * accumulator. Every LLM call (recordUsage) and every credit debit (credits.ts
 * → here) lands on this row, so a user's remaining credits reflect spend across
 * ALL their projects. Idempotent INSERT on UNIQUE(user_id, period_month);
 * accumulates on conflict. Seeds the per-user defaults (100 credits / $1) on the
 * first write of the month.
 */
export async function upsertUserMonthlyBudget(
  userId: string,
  periodMonth: string,
  costDelta: number,
): Promise<BudgetSnapshot> {
  const budgetId = generateId('ubud');
  await run(
    `INSERT INTO user_budgets
       (id, user_id, period_month, current_llm_usd, cap_llm_usd, warn_llm_usd, cap_credits, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(user_id, period_month) DO UPDATE SET
       current_llm_usd = user_budgets.current_llm_usd + excluded.current_llm_usd,
       updated_at = CURRENT_TIMESTAMP`,
    budgetId,
    userId,
    periodMonth,
    costDelta,
    USER_MONTHLY_LLM_USD,
    USER_MONTHLY_WARN_LLM_USD,
    USER_MONTHLY_CREDITS,
  );

  const rows = await query<BudgetSnapshot>(
    `SELECT id, current_llm_usd, warn_llm_usd, cap_llm_usd, cap_credits, status
     FROM user_budgets
     WHERE user_id = ? AND period_month = ?`,
    userId, periodMonth,
  );
  return rows[0];
}

export interface BudgetReconciliation {
  project_id: string;
  period_month: string;
  /** SUM(total_cost_usd) of llm_usage_logs rows created this month. */
  logged_usd: number;
  /** project_budgets.current_llm_usd — the running monthly accumulator. */
  budget_usd: number;
  /** budget_usd − logged_usd. Nonzero ⇒ a paired write was dropped. */
  drift_usd: number;
  /** True when |drift| is within rounding tolerance. */
  reconciled: boolean;
}

/**
 * Cross-check the two ledgers: the per-call audit trail (llm_usage_logs) vs the
 * running monthly accumulator (project_budgets.current_llm_usd).
 *
 * Every write path bumps the budget AND writes a log row — recordUsage(),
 * logUsageToDb(), and (since the 2026-06-14 audit) debitCredits(). So in steady
 * state SUM(logs this month) == current_llm_usd within float rounding. A
 * nonzero drift means one of those paired writes failed silently: all of them
 * are best-effort / fire-and-forget, so without this check a dropped write would
 * never surface. Catches both directions (orphan log row, or budget bumped with
 * no log).
 *
 * Pure read — no writes, no alerts, no side effects. Safe to call from a GET
 * endpoint (usage page) or the cron sweep.
 */
export async function reconcileProjectBudget(
  projectId: string,
  periodMonth: string = currentPeriodMonth(),
): Promise<BudgetReconciliation> {
  const [y, m] = periodMonth.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 1)).toISOString(); // first instant of next month

  const loggedRow = (await query<{ s: number }>(
    `SELECT COALESCE(SUM(total_cost_usd), 0) AS s
     FROM llm_usage_logs
     WHERE project_id = ? AND created_at >= ? AND created_at < ?`,
    projectId, start, end,
  ))[0];
  const loggedUsd = Number(loggedRow?.s ?? 0);

  const budgetRow = (await query<{ current_llm_usd: number }>(
    `SELECT current_llm_usd FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId, periodMonth,
  ))[0];
  const budgetUsd = Number(budgetRow?.current_llm_usd ?? 0);

  const driftUsd = budgetUsd - loggedUsd;
  // Tolerance: a sub-cent floor OR 2% relative, whichever is larger — absorbs
  // float rounding across many small upserts without flagging healthy projects.
  const tolerance = Math.max(0.01, budgetUsd * 0.02);
  const reconciled = Math.abs(driftUsd) <= tolerance;

  return {
    project_id: projectId,
    period_month: periodMonth,
    logged_usd: loggedUsd,
    budget_usd: budgetUsd,
    drift_usd: driftUsd,
    reconciled,
  };
}

export interface UserBudgetReconciliation {
  user_id: string;
  period_month: string;
  /** SUM(total_cost_usd) of llm_usage_logs across ALL the user's projects this month. */
  logged_usd: number;
  /** user_budgets.current_llm_usd — the authoritative per-user accumulator. */
  pool_usd: number;
  /** pool_usd − logged_usd. Nonzero ⇒ a paired user-pool write was dropped. */
  drift_usd: number;
  /** True when |drift| is within rounding tolerance. */
  reconciled: boolean;
}

/**
 * User-pool counterpart of reconcileProjectBudget. Credits are per-user
 * (2026-06-14): the authoritative accumulator is user_budgets.current_llm_usd,
 * which every spend path bumps — recordUsage(), logUsageToDb() (chat), and
 * debitCredits() — alongside a per-project llm_usage_logs row. So in steady
 * state user_budgets.current_llm_usd == SUM(logs across ALL the owner's
 * projects) for the month. Drift ⇒ a user-pool write was dropped (these are all
 * best-effort), which would otherwise silently mis-state the badge and cap.
 *
 * Pure read — no writes, no side effects.
 */
export async function reconcileUserBudget(
  userId: string,
  periodMonth: string = currentPeriodMonth(),
): Promise<UserBudgetReconciliation> {
  const [y, m] = periodMonth.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
  const end = new Date(Date.UTC(y, m, 1)).toISOString(); // first instant of next month

  const loggedRow = (await query<{ s: number }>(
    `SELECT COALESCE(SUM(total_cost_usd), 0) AS s
     FROM llm_usage_logs
     WHERE created_at >= ? AND created_at < ?
       AND project_id IN (SELECT id FROM projects WHERE owner_user_id = ?)`,
    start, end, userId,
  ))[0];
  const loggedUsd = Number(loggedRow?.s ?? 0);

  const poolRow = (await query<{ current_llm_usd: number }>(
    `SELECT current_llm_usd FROM user_budgets
     WHERE user_id = ? AND period_month = ?`,
    userId, periodMonth,
  ))[0];
  const poolUsd = Number(poolRow?.current_llm_usd ?? 0);

  const driftUsd = poolUsd - loggedUsd;
  const tolerance = Math.max(0.01, poolUsd * 0.02);
  const reconciled = Math.abs(driftUsd) <= tolerance;

  return {
    user_id: userId,
    period_month: periodMonth,
    logged_usd: loggedUsd,
    pool_usd: poolUsd,
    drift_usd: driftUsd,
    reconciled,
  };
}

function didCrossWarn(budget: BudgetSnapshot, costDelta: number): boolean {
  // "Crossed" means: we were below warn before this call, now at/above it.
  // costDelta may be small; compare before/after to avoid false positives.
  const before = budget.current_llm_usd - costDelta;
  return before < budget.warn_llm_usd && budget.current_llm_usd >= budget.warn_llm_usd;
}

async function maybeEmitBudgetWarning(projectId: string, periodMonth: string, budget: BudgetSnapshot): Promise<void> {
  // Only one warning alert per (project, month) — silently no-op if already issued.
  const existing = await query<{ c: number }>(
    `SELECT COUNT(*) as c FROM alerts
     WHERE project_id = ? AND type = 'budget_warning'
       AND created_at >= ? AND dismissed = false`,
    projectId,
    `${periodMonth}-01T00:00:00.000Z`,
  );
  if (existing[0]?.c > 0) return;

  const alertId = generateId('alrt');
  const pct = ((budget.current_llm_usd / budget.cap_llm_usd) * 100).toFixed(0);
  const msg = `LLM budget for ${periodMonth} at ${pct}% of cap ($${budget.current_llm_usd.toFixed(3)} / $${budget.cap_llm_usd.toFixed(2)}). Observe-only for now — no calls blocked.`;
  await run(
    `INSERT INTO alerts (id, project_id, type, severity, message, dismissed, source_url)
     VALUES (?, ?, 'budget_warning', 'warning', ?, false, ?)`,
    alertId, projectId, msg, null,
  );
}

// The shape of `Usage` from @mariozechner/pi-ai can vary by provider; the
// safest path is to read the known keys defensively. This helper lets the
// meter degrade gracefully when a field is absent (e.g. some mock providers
// in tests don't emit cost).
function extractCost(usage: Usage): number {
  const u = usage as unknown as Record<string, unknown>;
  const cost = u.cost as Record<string, unknown> | undefined;
  if (cost && typeof cost.total === 'number') return cost.total;
  // runAgentStream's done frame flattens pi-ai's cost.total into a plain
  // number (`cost: u.cost?.total`) — without this branch every streaming
  // consumer (e.g. the manual monitor run route) metered $0.00 while the
  // provider billed real money, silently starving the budget gate.
  if (typeof u.cost === 'number') return u.cost;
  if (typeof u.totalCost === 'number') return u.totalCost;
  return 0;
}

function extractTokens(usage: Usage, kind: 'input' | 'output' | 'cacheCreation' | 'cacheRead'): number {
  const u = usage as unknown as Record<string, unknown>;
  const keys: Record<typeof kind, string[]> = {
    input: ['input', 'inputTokens', 'input_tokens'],
    output: ['output', 'outputTokens', 'output_tokens'],
    cacheCreation: ['cacheCreation', 'cache_creation_tokens', 'cacheCreationInputTokens'],
    cacheRead: ['cacheRead', 'cache_read_tokens', 'cacheReadInputTokens'],
  };
  for (const k of keys[kind]) {
    const v = u[k];
    if (typeof v === 'number') return v;
  }
  return 0;
}
