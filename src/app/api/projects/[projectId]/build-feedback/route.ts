import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { addFeedback, listPendingFeedback, getCurrentBuild } from '@/lib/mvp/mvp-builds';

/**
 * GET /api/projects/{projectId}/build-feedback
 * List the not-yet-incorporated feedback (what the next iteration will address).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  return json(await listPendingFeedback(projectId));
}

/**
 * POST /api/projects/{projectId}/build-feedback
 * Capture a founder note that feeds the next iteration. Body: { body (required),
 * severity?, build_id? }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return error('Request body required');
  const text = String(body.body ?? '').trim();
  if (!text) return error('body is required');

  const current = body.build_id ? null : await getCurrentBuild(projectId);
  const row = await addFeedback({
    projectId,
    buildId: (body.build_id as string) ?? current?.id ?? null,
    source: 'founder',
    body: text.slice(0, 4000),
    severity: body.severity ? String(body.severity).slice(0, 20) : null,
  });
  return json(row);
}
