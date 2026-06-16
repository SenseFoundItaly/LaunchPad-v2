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

// =============================================================================
// Hard-stop enforcement (Phase 1)
// =============================================================================
//
// `recordUsage()` logs credits_remaining AFTER a run — it observes, never
// blocks. This helper is the BEFORE-the-run gate: callers (chat route, skill
// run:true branch) ask "may this user spend?" and get a yes/no.
//
// Gated behind CREDITS_HARD_STOP (OFF unless the env var is exactly "1" /
// "true"). Merging or deploying this code with the flag unset is a NO-OP — the
// lockout stays dormant. Flip it on only after payments + an exempt allowlist
// are in place (see the recharge route + CREDITS_EXEMPT_USER_IDS below).
//
// EXEMPTION: CREDITS_EXEMPT_USER_IDS is a comma-separated allowlist of user ids
// (e.g. the founder + admins) that are NEVER locked out, regardless of balance.
// No ids are hardcoded — an empty/unset var means "nobody is exempt".

/** True when the hard-stop lockout is enabled. Off by default — only "1" or
 *  "true" (case-insensitive) turns it on. */
export function isHardStopEnabled(): boolean {
  const v = (process.env.CREDITS_HARD_STOP ?? '').trim().toLowerCase();
  return v === '1' || v === 'true';
}

/** Is this user on the never-lock-out allowlist? Parsed from
 *  CREDITS_EXEMPT_USER_IDS (comma-separated). Empty/unset ⇒ nobody exempt. */
export function isCreditsExempt(userId: string): boolean {
  if (!userId) return false;
  const raw = process.env.CREDITS_EXEMPT_USER_IDS ?? '';
  if (!raw.trim()) return false;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

export interface CreditsGate {
  /** May this user start a metered run right now? */
  allowed: boolean;
  /** Remaining credits in the user's monthly pool (0 when out). */
  remaining: number;
  /** Why it was allowed/denied — for logging/telemetry. */
  reason: 'flag_off' | 'exempt' | 'has_credits' | 'out_of_credits';
}

/**
 * The BEFORE-the-run credit gate, keyed by user. Returns {allowed:false} ONLY
 * when ALL of these hold: the hard-stop flag is on, the user is NOT exempt, and
 * the user's pool is empty (remaining <= 0, i.e. current_llm_usd >= cap_llm_usd
 * — the same boundary recordUsage uses for credits_remaining).
 *
 * Fail-OPEN by design: with the flag off, or for an exempt user, or when no
 * userId is supplied, we allow. A billing gate must never wedge a legitimate
 * user out because of an env typo — the founder grace path
 * (CREDITS_EXEMPT_USER_IDS) is the explicit safety valve.
 */
export async function assertCreditsAvailable(userId: string): Promise<CreditsGate> {
  if (!isHardStopEnabled()) return { allowed: true, remaining: Infinity, reason: 'flag_off' };
  if (!userId || isCreditsExempt(userId)) {
    return { allowed: true, remaining: Infinity, reason: 'exempt' };
  }

  const snap = await getUserCreditsSnapshot(userId);
  if (snap.remaining > 0) {
    return { allowed: true, remaining: snap.remaining, reason: 'has_credits' };
  }
  return { allowed: false, remaining: 0, reason: 'out_of_credits' };
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

/**
 * Free self-serve top-up (INTERIM — no payments integrated yet; founder
 * decision 2026-06-16). Grants a CLEAN prepaid balance: the founder ends with
 * `old_remaining + credits` usable, shown as a tidy `N/N`.
 *
 * Why it forgives this period's POOL usage (sets current_llm_usd = 0):
 *   remaining = cap_credits − round(current_llm_usd × creditsPerDollar).
 *   Accounts that overspent in observe-mode (before enforcement existed) carry a
 *   large current_llm_usd — e.g. $53 → 16k "used" credits. A plain cap bump
 *   either left remaining stuck at 0 (under-grant) or, if we raised the cap to
 *   chase the overspend, showed an alarming total like "472/16599". Neither is
 *   what "recharge 500" should mean. So recharge zeroes the per-user POOL meter
 *   and sets cap = old_remaining + credits → snapshot shows remaining = total =
 *   old_remaining + credits. Markup ratio (creditsPerDollar) is preserved.
 *
 * Cost history is NOT lost: real spend stays in project_budgets + llm_usage_logs
 * (the usage page). Only the per-user CREDIT pool resets. This intentionally
 * creates a user_budgets-vs-logs drift that cron reconcile WARNS about (it never
 * auto-corrects) — acceptable while recharge is free. When Stripe lands, recharge
 * should instead ADD to the cap behind a verified payment WITHOUT zeroing usage.
 *
 * Returns the refreshed snapshot. Clamped to a sane per-call ceiling so a
 * tampered client body can't mint an absurd balance.
 */
export async function bumpUserCredits(userId: string, credits: number): Promise<CreditsSnapshot> {
  const add = Math.max(0, Math.min(Math.round(credits), 5000));
  if (userId && add > 0) {
    const existing = await getUserBudget(userId);
    const currentCapCredits = existing?.cap_credits ?? DEFAULT_CAP_CREDITS;
    const currentCapUsd = existing?.cap_llm_usd ?? USER_MONTHLY_LLM_USD;
    const usedUsd = existing?.current_llm_usd ?? 0;
    const creditsPerDollar =
      currentCapCredits > 0 && currentCapUsd > 0
        ? currentCapCredits / currentCapUsd
        : DEFAULT_CREDITS_PER_DOLLAR;
    const creditsUsed = Math.round(usedUsd * creditsPerDollar);
    const oldRemaining = Math.max(0, currentCapCredits - creditsUsed);
    // Clean balance: forgive pool usage (current_llm_usd → 0) and set the cap to
    // exactly what should be spendable, so remaining = total = oldRemaining + add.
    const newCapCredits = oldRemaining + add;
    const newCapUsd = newCapCredits / creditsPerDollar;
    const now = new Date().toISOString();

    await run(
      `INSERT INTO user_budgets (
         id, user_id, period_month, current_llm_usd, cap_llm_usd, cap_credits, status, created_at, updated_at
       )
       VALUES (?, ?, ?, 0, ?, ?, 'active', ?, ?)
       ON CONFLICT(user_id, period_month) DO UPDATE SET
         current_llm_usd = 0,
         cap_llm_usd = ?,
         cap_credits = ?,
         status = 'active',
         updated_at = ?`,
      generateId('ubud'),
      userId,
      currentPeriodMonth(),
      newCapUsd,
      newCapCredits,
      now,
      now,
      // ON CONFLICT values
      newCapUsd,
      newCapCredits,
      now,
    );
  }
  return getUserCreditsSnapshot(userId);
}
