import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { listBuilds } from '@/lib/mvp/mvp-builds';
import { getActiveBuilder } from '@/lib/builders';
import { startBuild } from '@/lib/mvp/build-runner';

/**
 * GET /api/projects/{projectId}/builds
 * List builds (newest iteration first) + the active driver.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const builds = await listBuilds(projectId);
  const builder = getActiveBuilder();
  return json({
    builds,
    active_builder: {
      id: builder.id,
      label: builder.label,
      supports_iteration: builder.supportsIteration,
      supports_async: !!builder.supportsAsync,
    },
  });
}

/**
 * POST /api/projects/{projectId}/builds
 * Kick off a build ASYNC: assemble intelligence → hand the prose to the active
 * driver (async when supported) → return a 'building' row FAST. The client polls
 * GET /builds/[buildId] to completion. (No blocking LLM skill on the critical
 * path — the builder's own agent does the building.)
 * TODO(Phase C): isProjectCapped gate before paid drivers.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  try {
    const build = await startBuild(projectId, auth.session.userId);
    if (build.status === 'failed') {
      const msg = (build.metadata as Record<string, unknown> | null)?.error;
      return error(`Build failed to start: ${msg || 'unknown error'}`, 502);
    }
    return json(build);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.startsWith('BUILD_CAPPED:')) return error(msg.replace('BUILD_CAPPED: ', ''), 402);
    return error(`Failed to start build: ${msg}`, 502);
  }
}
