import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { getBuild, updateBuild } from '@/lib/mvp/mvp-builds';
import { applyIteration } from '@/lib/mvp/run-iteration';

/**
 * GET /api/projects/{projectId}/builds/{buildId}
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; buildId: string }> },
) {
  const { projectId, buildId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const build = await getBuild(buildId);
  if (!build || build.project_id !== projectId) return error('Build not found', 404);
  return json(build);
}

/**
 * PATCH /api/projects/{projectId}/builds/{buildId}
 *
 * Verbs are folded onto the dynamic leaf (OpenNext static-leaf 404 footgun):
 *   - { action: 'iterate', message } — iterate the build in place; the driver
 *     edits + rebuilds, and we record a new iteration row (supersedes prior).
 *   - { live_app_url, status } — set the founder-provided live URL / status.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; buildId: string }> },
) {
  const { projectId, buildId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const build = await getBuild(buildId);
  if (!build || build.project_id !== projectId) return error('Build not found', 404);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return error('Request body required');

  // ── Iterate verb ────────────────────────────────────────────────────────
  if (body.action === 'iterate') {
    const message = String(body.message ?? '').trim();
    if (!message) return error('message is required to iterate');
    try {
      const next = await applyIteration(build, message, auth.session.userId);
      return json(next);
    } catch (e) {
      return error(`Iteration failed: ${(e as Error).message}`, 502);
    }
  }

  // ── Field update ──────────────────────────────────────────────────────────
  const patch: Parameters<typeof updateBuild>[1] = {};
  if (typeof body.live_app_url === 'string') patch.liveAppUrl = body.live_app_url.trim() || null;
  if (typeof body.status === 'string') patch.status = body.status;
  if (Object.keys(patch).length === 0) return error('No supported fields to update');

  // TODO(Phase 2+): when live_app_url is set, register a watch_source for Firecrawl
  // monitoring and store watch_source_id on the build.
  const updated = await updateBuild(buildId, patch);
  return json(updated);
}
