import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import {
  listAssumptions,
  extractAssumptions,
  type AssumptionCriticality,
  type AssumptionCategory,
  type AssumptionStatus,
} from '@/lib/assumptions';

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'open', 'validated', 'invalidated', 'accepted_risk',
]);

/**
 * GET /api/projects/:projectId/assumptions
 *
 * Query params (all optional):
 *   status=open|validated|invalidated|accepted_risk (comma-separated also OK)
 *   criticality=high|medium|low
 *   category=market|user_behavior|execution|financial|competitive|org|external
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const criticalityParam = url.searchParams.get('criticality');
  const categoryParam = url.searchParams.get('category');

  let status: AssumptionStatus | AssumptionStatus[] | undefined;
  if (statusParam) {
    const parts = statusParam.split(',').map(s => s.trim()).filter(Boolean);
    const valid = parts.filter(s => VALID_STATUSES.has(s)) as AssumptionStatus[];
    if (valid.length === 0) return error('invalid status filter');
    status = valid.length === 1 ? valid[0] : valid;
  }

  const rows = await listAssumptions(projectId, {
    status,
    criticality: (criticalityParam as AssumptionCriticality | null) ?? undefined,
    category: (categoryParam as AssumptionCategory | null) ?? undefined,
  });

  return json(rows);
}

/**
 * POST /api/projects/:projectId/assumptions
 *
 * Body: { context: string }
 *
 * Runs the extractor pass over the provided project context and inserts new
 * assumption rows (numbered continuing from the project's current max).
 * Idempotent at the row level via the `(project_id, number)` unique
 * constraint, but the extractor's output varies — callers should typically
 * trigger this once per major canvas update rather than on every page load.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: { context?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('invalid JSON body');
  }

  if (typeof body.context !== 'string' || body.context.trim().length < 40) {
    return error('context required (min 40 chars)');
  }

  const result = await extractAssumptions(projectId, body.context);
  return json(result, 201);
}
