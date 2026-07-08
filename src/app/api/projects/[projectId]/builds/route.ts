import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { runSkill } from '@/lib/skill-executor';
import { assembleMvpContext, renderMvpContextProse } from '@/lib/mvp/assemble-context';
import { createBuild, listBuilds, updateBuild } from '@/lib/mvp/mvp-builds';
import { getActiveBuilder } from '@/lib/builders';

const MAX_PROMPT_CHARS = 50_000;

/**
 * GET /api/projects/{projectId}/builds
 * List builds for a project (newest iteration first) + the active driver.
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
    active_builder: { id: builder.id, label: builder.label, supports_iteration: builder.supportsIteration },
  });
}

/**
 * POST /api/projects/{projectId}/builds
 * Generate a new build: assemble intelligence → run the mvp-build-spec skill →
 * hand the prompt to the active builder driver → persist the mvp_builds row.
 *
 * NOTE (Phase 0): synchronous. Fine for the stub driver; the real v0/E2B drivers
 * run multi-second agentic builds and must move to an async job + polling/SSE.
 * TODO(cost-gate): call isProjectCapped(projectId) before running a real driver.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const ctx = await assembleMvpContext(projectId);
  const prose = renderMvpContextProse(ctx);
  const userMsg = `${prose}\n\nGenerate the ${ctx.isDelta ? 'iteration delta' : 'initial'} build prompt now, following the output contract.`;

  let specPrompt: string;
  try {
    const result = await runSkill(projectId, 'mvp-build-spec', {
      ownerUserId: auth.session.userId,
      prompt: userMsg,
      allowAnySkill: true,
      timeoutMs: 170_000,
    });
    specPrompt = (result.summary || '').trim().slice(0, MAX_PROMPT_CHARS);
  } catch (e) {
    return error(`Failed to generate build prompt: ${(e as Error).message}`, 502);
  }
  if (!specPrompt) return error('Build prompt generation returned empty output', 502);

  const builder = getActiveBuilder();
  const build = await createBuild({
    projectId,
    builder: builder.id,
    specPrompt,
    status: 'building',
  });

  try {
    const result = await builder.create(
      { projectId, buildId: build.id, ownerUserId: auth.session.userId },
      { prompt: specPrompt, imageUrls: ctx.snapshot ? undefined : undefined },
    );
    const updated = await updateBuild(build.id, {
      builderRef: result.builderRef,
      substrate: result.substrate ?? null,
      previewUrl: result.previewUrl ?? null,
      liveAppUrl: result.liveUrl ?? null,
      status: result.status === 'failed' ? 'failed' : 'live',
      metadata: result.logs ? { logs: result.logs, diff: result.diff ?? null } : undefined,
    });
    return json(updated ?? build);
  } catch (e) {
    await updateBuild(build.id, { status: 'failed', metadata: { error: (e as Error).message } });
    return error(`Builder driver failed: ${(e as Error).message}`, 502);
  }
}
