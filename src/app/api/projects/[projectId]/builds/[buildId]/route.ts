import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { getBuild, updateBuild } from '@/lib/mvp/mvp-builds';
import { startIteration, refreshBuild, publishBuild } from '@/lib/mvp/build-runner';
import { ensureLiveAppWatch } from '@/lib/mvp/live-app-watch';

/**
 * GET /api/projects/{projectId}/builds/{buildId}
 * Polls the driver: advances a 'building' row toward live/failed and keeps a live
 * build's (expiring) preview URL fresh. The client polls this while status='building'.
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
  const refreshed = await refreshBuild(build);
  return json(refreshed);
}

/**
 * PATCH /api/projects/{projectId}/builds/{buildId}
 * Verbs folded onto the dynamic leaf (OpenNext static-leaf 404 footgun):
 *   - { action: 'iterate', message } — kick off an iteration ASYNC (new 'building'
 *     row); the client polls GET to completion.
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

  // ── Iterate verb (async) ──────────────────────────────────────────────────
  if (body.action === 'iterate') {
    const message = String(body.message ?? '').trim();
    if (!message) return error('message is required to iterate');
    try {
      const next = await startIteration(build, message, auth.session.userId);
      if (next.status === 'failed') {
        const msg = (next.metadata as Record<string, unknown> | null)?.error;
        return error(`Iteration failed to start: ${msg || 'unknown error'}`, 502);
      }
      return json(next);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('BUILD_CAPPED:')) return error(msg.replace('BUILD_CAPPED: ', ''), 402);
      if (msg.startsWith('BUILD_UNSUPPORTED:')) return error(msg.replace('BUILD_UNSUPPORTED: ', ''), 400);
      return error(`Iteration failed: ${msg}`, 502);
    }
  }

  // ── Publish verb (white-label): deploy the live build to a hosted URL ──────
  if (body.action === 'publish') {
    try {
      const published = await publishBuild(build);
      return json(published);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.startsWith('BUILD_CAPPED:')) return error(msg.replace('BUILD_CAPPED: ', ''), 402);
      if (msg.startsWith('BUILD_UNSUPPORTED:')) return error(msg.replace('BUILD_UNSUPPORTED: ', ''), 400);
      return error(`Publish failed: ${msg}`, 502);
    }
  }

  // ── Field update ──────────────────────────────────────────────────────────
  const patch: Parameters<typeof updateBuild>[1] = {};
  if (typeof body.live_app_url === 'string') patch.liveAppUrl = body.live_app_url.trim() || null;
  if (typeof body.status === 'string') patch.status = body.status;
  if (Object.keys(patch).length === 0) return error('No supported fields to update');

  // When the founder sets a live URL, register it for Firecrawl change-tracking so
  // its source_changes feed the iteration proposer (monitor → next-iteration loop).
  if (patch.liveAppUrl && !build.watch_source_id) {
    const wsId = await ensureLiveAppWatch(projectId, patch.liveAppUrl).catch(() => null);
    if (wsId) patch.watchSourceId = wsId;
  }
  const updated = await updateBuild(buildId, patch);
  return json(updated);
}
