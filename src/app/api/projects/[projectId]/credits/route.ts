import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { getCreditsSnapshot, getUserCreditsSnapshot } from '@/lib/credits';
import { ownerUserId } from '@/lib/cost-meter';
import { USER_MONTHLY_CREDITS, USER_MONTHLY_LLM_USD } from '@/lib/credit-costs';

/**
 * GET /api/projects/{projectId}/credits
 *
 * Cheap snapshot endpoint for the TopBar credits badge. Credits are per-USER
 * (2026-06-14): getCreditsSnapshot resolves the project's owner and returns
 * their shared pool, so opening ANY of a user's projects shows the same number.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const project = await get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
  if (!project) return error('Project not found', 404);
  return json(await getCreditsSnapshot(projectId));
}

/**
 * PATCH /api/projects/{projectId}/credits
 *
 * Bump free credits on the project OWNER's monthly pool. Accepts
 * { action: "bump", amount?: number }. Dev/E2E affordance only (the badge gates
 * the button behind NODE_ENV !== 'production'). Computes the proportional USD
 * increase from the pool's creditsPerDollar ratio and UPSERTs user_budgets.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  // SECURITY: this mints free credits. It is a dev/E2E affordance only — the
  // client gated the button behind NODE_ENV, but the route had no server guard,
  // so a crafted request could mint credits in production. Hard-stop here.
  if (process.env.NODE_ENV === 'production') {
    return error('Not available in production', 403);
  }

  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const owner = await ownerUserId(projectId);
  if (!owner) return error('Project has no owner to credit', 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }
  if (body.action !== 'bump') return error('Invalid action — expected "bump"', 400);

  const bumpCredits = typeof body.amount === 'number' && body.amount > 0
    ? Math.min(body.amount, 1000)
    : 100;

  const periodMonth = currentPeriodMonth();
  const existing = await get<{
    cap_llm_usd: number;
    cap_credits: number;
  }>(
    `SELECT cap_llm_usd, cap_credits FROM user_budgets
     WHERE user_id = ? AND period_month = ?`,
    owner,
    periodMonth,
  );

  const currentCapCredits = existing?.cap_credits ?? USER_MONTHLY_CREDITS;
  const currentCapUsd = existing?.cap_llm_usd ?? USER_MONTHLY_LLM_USD;
  const creditsPerDollar = currentCapCredits > 0
    ? currentCapCredits / currentCapUsd
    : USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD; // canonical default ratio (was a stale hardcoded 100)

  const newCapCredits = currentCapCredits + bumpCredits;
  const newCapUsd = newCapCredits / creditsPerDollar;

  const budgetId = generateId('ubud');
  const now = new Date().toISOString();

  await run(
    `INSERT INTO user_budgets (
       id, user_id, period_month, cap_llm_usd, cap_credits, status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(user_id, period_month) DO UPDATE SET
       cap_llm_usd = ?,
       cap_credits = ?,
       status = 'active',
       updated_at = ?`,
    budgetId,
    owner,
    periodMonth,
    newCapUsd,
    newCapCredits,
    now,
    now,
    // ON CONFLICT values
    newCapUsd,
    newCapCredits,
    now,
  );

  return json(await getUserCreditsSnapshot(owner));
}

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
