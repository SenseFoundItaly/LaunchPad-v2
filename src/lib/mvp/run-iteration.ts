// ============================================================================
// Shared iteration mechanics for the Build & Launch Hub. Used by:
//   - PATCH /builds/[buildId] { action: 'iterate' }  (founder-typed change)
//   - the mvp_build_iteration executor                (cron-proposed, skill-drafted)
//
// applyIteration() runs the driver's in-place iterate and records a new
// iteration row (superseding the prior, folding pending feedback in).
// generateAndApplyIteration() first drafts a delta prompt from accumulated
// feedback via the mvp-build-spec skill, then applies it.
// ============================================================================

import { runSkill } from '@/lib/skill-executor';
import { getBuilder, getActiveBuilder } from '@/lib/builders';
import type { BuilderAdapter, BuilderId } from '@/lib/builders/types';
import {
  type MvpBuild,
  createBuild,
  supersedeOtherBuilds,
  markFeedbackIncorporated,
} from './mvp-builds';
import { assembleMvpContext, renderMvpContextProse } from './assemble-context';

const MAX_PROMPT_CHARS = 50_000;

function resolveBuilder(id: string): BuilderAdapter {
  try {
    return getBuilder(id as BuilderId);
  } catch {
    return getActiveBuilder();
  }
}

/** Apply one change message to a build via its driver → a new iteration row. */
export async function applyIteration(
  build: MvpBuild,
  message: string,
  ownerUserId?: string,
): Promise<MvpBuild> {
  const builder = resolveBuilder(build.builder);
  if (!builder.supportsIteration) {
    throw new Error(`Builder "${builder.id}" does not support in-place iteration`);
  }
  const result = await builder.iterate(
    { projectId: build.project_id, buildId: build.id, ownerUserId },
    build.builder_ref ?? '',
    message,
  );
  const next = await createBuild({
    projectId: build.project_id,
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
  await supersedeOtherBuilds(build.project_id, next.id);
  // Any feedback accumulated up to now is addressed by this iteration.
  await markFeedbackIncorporated(build.project_id, next.iteration);
  return next;
}

/** Draft a delta prompt from accumulated feedback (skill) and apply it. */
export async function generateAndApplyIteration(build: MvpBuild): Promise<MvpBuild> {
  const ctx = await assembleMvpContext(build.project_id);
  const prose = renderMvpContextProse(ctx);
  const userMsg = `${prose}\n\nGenerate the iteration delta build prompt now, following the output contract.`;
  const result = await runSkill(build.project_id, 'mvp-build-spec', {
    ownerUserId: ctx.ownerUserId ?? '',
    prompt: userMsg,
    allowAnySkill: true,
    timeoutMs: 170_000,
  });
  const message = (result.summary || '').trim().slice(0, MAX_PROMPT_CHARS) || 'Apply the accumulated feedback.';
  return applyIteration(build, message, ctx.ownerUserId ?? undefined);
}
