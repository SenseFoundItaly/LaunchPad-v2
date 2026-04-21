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
import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { logToLangfuse } from '@/lib/telemetry';

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
}

export interface RecordUsageResult {
  log_id: string;
  cost_usd: number;
  total_tokens: number;
  crossed_warn: boolean;
  current_llm_usd: number;
  cap_llm_usd: number;
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
export function recordUsage(input: RecordUsageInput): RecordUsageResult | null {
  if (!input.usage) return null;

  const costUsd = extractCost(input.usage);
  const inputTokens = extractTokens(input.usage, 'input');
  const outputTokens = extractTokens(input.usage, 'output');
  const cacheCreation = extractTokens(input.usage, 'cacheCreation');
  const cacheRead = extractTokens(input.usage, 'cacheRead');

  const logId = generateId('llmlg');
  run(
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
  const budget = upsertMonthlyBudget(input.project_id, periodMonth, costUsd);

  const crossedWarn = didCrossWarn(input.project_id, periodMonth, budget, costUsd);
  if (crossedWarn) {
    maybeEmitBudgetWarning(input.project_id, periodMonth, budget);
  }

  // Mirror the call into Langfuse so cron/manual monitor runs appear in the
  // same dashboard as chat traces. logToLangfuse lazy-inits the Langfuse
  // client and silently no-ops when LANGFUSE_SECRET_KEY is absent, so this
  // is safe to call unconditionally from local-dev or prod.
  const provider = (input.provider === 'anthropic' || input.provider === 'openai')
    ? input.provider
    : 'anthropic';
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

  return {
    log_id: logId,
    cost_usd: costUsd,
    total_tokens: inputTokens + outputTokens,
    crossed_warn: crossedWarn,
    current_llm_usd: budget.current_llm_usd,
    cap_llm_usd: budget.cap_llm_usd,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface BudgetSnapshot {
  id: string;
  current_llm_usd: number;
  warn_llm_usd: number;
  cap_llm_usd: number;
  status: string;
}

function upsertMonthlyBudget(
  projectId: string,
  periodMonth: string,
  costDelta: number,
): BudgetSnapshot {
  // ON CONFLICT DO UPDATE accumulates current_llm_usd. UNIQUE(project_id,
  // period_month) constraint makes this atomic in SQLite.
  const budgetId = generateId('bud');
  run(
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

  const rows = query<BudgetSnapshot>(
    `SELECT id, current_llm_usd, warn_llm_usd, cap_llm_usd, status
     FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId, periodMonth,
  );
  return rows[0];
}

function didCrossWarn(
  projectId: string,
  periodMonth: string,
  budget: BudgetSnapshot,
  costDelta: number,
): boolean {
  // "Crossed" means: we were below warn before this call, now at/above it.
  // costDelta may be small; compare before/after to avoid false positives.
  const before = budget.current_llm_usd - costDelta;
  return before < budget.warn_llm_usd && budget.current_llm_usd >= budget.warn_llm_usd;
}

function maybeEmitBudgetWarning(projectId: string, periodMonth: string, budget: BudgetSnapshot): void {
  // Only one warning alert per (project, month) — silently no-op if already issued.
  const existing = query<{ c: number }>(
    `SELECT COUNT(*) as c FROM alerts
     WHERE project_id = ? AND type = 'budget_warning'
       AND created_at >= ? AND dismissed = 0`,
    projectId,
    `${periodMonth}-01T00:00:00.000Z`,
  );
  if (existing[0]?.c > 0) return;

  const alertId = generateId('alrt');
  const pct = ((budget.current_llm_usd / budget.cap_llm_usd) * 100).toFixed(0);
  const msg = `LLM budget for ${periodMonth} at ${pct}% of cap ($${budget.current_llm_usd.toFixed(3)} / $${budget.cap_llm_usd.toFixed(2)}). Observe-only for now — no calls blocked.`;
  run(
    `INSERT INTO alerts (id, project_id, type, severity, message, dismissed)
     VALUES (?, ?, 'budget_warning', 'warning', ?, 0)`,
    alertId, projectId, msg,
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
