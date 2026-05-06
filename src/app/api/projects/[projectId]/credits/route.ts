import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { getCreditsSnapshot } from '@/lib/credits';

/**
 * GET /api/projects/{projectId}/credits
 *
 * Cheap snapshot endpoint for the TopBar credits badge. Safe to poll on a
 * 30s interval. Returns the same shape as `getCreditsSnapshot()` so the
 * client can show "remaining" + the soft "used_today / daily_cap" anchor.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const project = await get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
  if (!project) return error('Project not found', 404);
  return json(await getCreditsSnapshot(projectId));
}

/**
 * PATCH /api/projects/{projectId}/credits
 *
 * Bump free credits. Accepts { action: "bump", amount?: number }.
 * Default bump: +100 credits. Computes proportional USD increase using
 * the existing creditsPerDollar ratio and UPSERTs project_budgets.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const project = await get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
  if (!project) return error('Project not found', 404);

  const body = await request.json().catch(() => ({}));
  if (body.action !== 'bump') return error('Invalid action — expected "bump"', 400);

  const bumpCredits = typeof body.amount === 'number' && body.amount > 0
    ? Math.min(body.amount, 1000)
    : 100;

  // Fetch current budget row (if any) to compute proportional USD bump
  const periodMonth = currentPeriodMonth();
  const existing = await get<{
    cap_llm_usd: number;
    cap_credits: number;
  }>(
    `SELECT cap_llm_usd, cap_credits FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId,
    periodMonth,
  );

  const currentCapCredits = existing?.cap_credits ?? 100;
  const currentCapUsd = existing?.cap_llm_usd ?? 5.00;
  const creditsPerDollar = currentCapCredits > 0
    ? currentCapCredits / currentCapUsd
    : 200; // fallback

  const newCapCredits = currentCapCredits + bumpCredits;
  const newCapUsd = newCapCredits / creditsPerDollar;

  const budgetId = generateId('bud');
  const now = new Date().toISOString();

  await run(
    `INSERT INTO project_budgets (
       id, project_id, period_month, cap_llm_usd, cap_credits, status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(project_id, period_month) DO UPDATE SET
       cap_llm_usd = ?,
       cap_credits = ?,
       status = 'active',
       updated_at = ?`,
    budgetId,
    projectId,
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

  return json(await getCreditsSnapshot(projectId));
}

function currentPeriodMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
