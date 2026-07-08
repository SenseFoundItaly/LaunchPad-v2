import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import {
  getBuild,
  createBuild,
  updateBuild,
  supersedeOtherBuilds,
  addFeedback,
  markFeedbackIncorporated,
} from '@/lib/mvp/mvp-builds';
import { getBuilder, getActiveBuilder } from '@/lib/builders';
import type { BuilderAdapter, BuilderId } from '@/lib/builders/types';

function resolveBuilder(id: string): BuilderAdapter {
  try {
    return getBuilder(id as BuilderId);
  } catch {
    // The recorded driver isn't registered on this branch — fall back so the
    // build stays operable (e.g. an 'e2b' row viewed on the shared-core branch).
    return getActiveBuilder();
  }
}

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

    const builder = resolveBuilder(build.builder);
    if (!builder.supportsIteration) {
      return error(`Builder "${builder.id}" does not support in-place iteration`, 409);
    }

    let result;
    try {
      result = await builder.iterate(
        { projectId, buildId: build.id, ownerUserId: auth.session.userId },
        build.builder_ref ?? '',
        message,
      );
    } catch (e) {
      return error(`Iteration failed: ${(e as Error).message}`, 502);
    }

    const next = await createBuild({
      projectId,
      builder: build.builder,
      substrate: result.substrate ?? build.substrate,
      builderRef: result.builderRef,
      previewUrl: result.previewUrl ?? null,
      liveAppUrl: result.liveUrl ?? null,
      status: result.status === 'failed' ? 'failed' : 'live',
      specPrompt: message,
      parentBuildId: build.id,
      iteration: build.iteration + 1,
      metadata: result.diff ? { diff: result.diff, logs: result.logs ?? null } : undefined,
    });
    await supersedeOtherBuilds(projectId, next.id);
    // Record the change request and mark accumulated feedback as folded in.
    await addFeedback({ projectId, buildId: build.id, source: 'founder', body: message });
    await markFeedbackIncorporated(projectId, next.iteration);
    return json(next);
  }

  // ── Field update ──────────────────────────────────────────────────────────
  const patch: Parameters<typeof updateBuild>[1] = {};
  if (typeof body.live_app_url === 'string') patch.liveAppUrl = body.live_app_url.trim() || null;
  if (typeof body.status === 'string') patch.status = body.status;
  if (Object.keys(patch).length === 0) return error('No supported fields to update');

  // TODO(Phase 2): when live_app_url is set, register a watch_source for Firecrawl
  // monitoring and store watch_source_id on the build.
  const updated = await updateBuild(buildId, patch);
  return json(updated);
}
