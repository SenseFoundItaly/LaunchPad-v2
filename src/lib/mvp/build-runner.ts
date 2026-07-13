// ============================================================================
// Async build orchestration for the Build & Launch Hub.
//
// The interactive path (POST /builds, PATCH iterate, GET poll) is ASYNC so it
// survives Netlify's ~10-26s function limit: kick off the driver fast (v0 async
// mode / instant stub), store a 'building' row, and let the client poll
// GET /builds/[buildId] → refreshBuild() → driver.getStatus() until 'live'.
//
// It also feeds the driver the assembled-intelligence PROSE directly (no ~30s
// mvp-build-spec LLM call on the critical path) — the builder's own agent does
// the building. The skill remains available for other surfaces.
// ============================================================================

import { run, query } from '@/lib/db';
import { assembleMvpContext, renderBuildBrief } from './assemble-context';
import { getActiveBuilder, getBuilder } from '@/lib/builders';
import type { BuilderAdapter, BuilderId } from '@/lib/builders/types';
import { isProjectCapped } from '@/lib/cost-meter';
import {
  type MvpBuild,
  createBuild,
  getBuild,
  updateBuild,
  supersedeOtherBuilds,
  markFeedbackIncorporated,
} from './mvp-builds';

const MAX_PROMPT_CHARS = 50_000;

function resolveBuilder(id?: string | null): BuilderAdapter {
  if (id) {
    try {
      return getBuilder(id as BuilderId);
    } catch {
      /* fall through to active */
    }
  }
  return getActiveBuilder();
}

/**
 * Gate a PAID build/iteration before it runs (v0 credits, E2B compute, Opus
 * tokens all bill to us). The stub is free → always allowed. Throws a
 * `BUILD_CAPPED:`-prefixed error (routes map it to 402) when the project owner is
 * over their credit cap, or a global kill-switch is set. Cheap (one SELECT).
 */
export async function assertBuildAllowed(projectId: string, builder: BuilderAdapter): Promise<void> {
  if (builder.id === 'stub') return;
  if (process.env.BUILD_KILL_SWITCH === '1') {
    throw new Error('BUILD_CAPPED: Builds are temporarily paused.');
  }
  const cap = await isProjectCapped(projectId);
  if (cap.capped) {
    throw new Error(
      `BUILD_CAPPED: Credit cap reached ($${cap.currentUsd.toFixed(2)} of $${cap.capUsd.toFixed(2)} this month) — builds are paused until it resets or the cap is raised.`,
    );
  }
}

/**
 * Build the driver message straight from assembled intelligence (fast — no LLM skill).
 * A driver "create" spins up a FRESH build (new v0 chat / new sandbox), so it must
 * always be an INITIAL prompt even if the project has prior builds — pass
 * forceInitial. Iterations go through startIteration with the founder's message.
 */
export async function buildSpecFromContext(projectId: string): Promise<{ prompt: string; isDelta: boolean }> {
  const ctx = await assembleMvpContext(projectId);
  // A create is always a fresh build → a clean imperative brief. App builders
  // (v0/E2B) build reliably from a direct "Build X that does Y…" instruction and
  // NOT from a context dump. Iterations use the founder message via startIteration.
  return { prompt: renderBuildBrief(ctx).slice(0, MAX_PROMPT_CHARS), isDelta: false };
}

/** Start a new build: create a 'building' row + kick off the driver (async when supported). */
export async function startBuild(projectId: string, ownerUserId?: string): Promise<MvpBuild> {
  const builder = getActiveBuilder();
  await assertBuildAllowed(projectId, builder);
  const { prompt } = await buildSpecFromContext(projectId);
  const build = await createBuild({ projectId, builder: builder.id, specPrompt: prompt, status: 'building' });
  const ref = { projectId, buildId: build.id, ownerUserId };
  try {
    const res =
      builder.supportsAsync && builder.createAsync
        ? await builder.createAsync(ref, { prompt })
        : await builder.create(ref, { prompt });
    const updated = await updateBuild(build.id, {
      builderRef: res.builderRef,
      substrate: res.substrate ?? null,
      previewUrl: res.previewUrl ?? null,
      liveAppUrl: res.liveUrl ?? null,
      status: res.status,
      metadata: { versionRef: res.versionRef ?? null, logs: res.logs ?? null, diff: res.diff ?? null },
    });
    // Instant drivers (stub / sync) already finished — settle immediately.
    if (res.status === 'live') await supersedeOtherBuilds(projectId, build.id);
    return updated ?? build;
  } catch (e) {
    return (await updateBuild(build.id, { status: 'failed', metadata: { error: (e as Error).message } })) ?? build;
  }
}

/** Start an iteration: new 'building' row (iteration+1) + kick off the driver's iterate. */
export async function startIteration(build: MvpBuild, message: string, ownerUserId?: string): Promise<MvpBuild> {
  const builder = resolveBuilder(build.builder);
  if (!builder.supportsIteration) throw new Error(`Builder "${builder.id}" does not support iteration`);
  await assertBuildAllowed(build.project_id, builder);
  const ref = { projectId: build.project_id, buildId: build.id, ownerUserId };
  const next = await createBuild({
    projectId: build.project_id,
    builder: build.builder,
    substrate: build.substrate,
    builderRef: build.builder_ref,
    specPrompt: message,
    parentBuildId: build.id,
    iteration: build.iteration + 1,
    status: 'building',
  });
  try {
    const res =
      builder.supportsAsync && builder.iterateAsync
        ? await builder.iterateAsync(ref, build.builder_ref ?? '', message)
        : await builder.iterate(ref, build.builder_ref ?? '', message);
    const updated = await updateBuild(next.id, {
      builderRef: res.builderRef || build.builder_ref,
      previewUrl: res.previewUrl ?? null,
      liveAppUrl: res.liveUrl ?? null,
      status: res.status,
      // `awaitAfterVersion` = the version to wait past (v0 iterateAsync returns the prior one).
      metadata: { awaitAfterVersion: res.versionRef ?? null, logs: res.logs ?? null, diff: res.diff ?? null },
    });
    if (res.status === 'live') {
      await supersedeOtherBuilds(build.project_id, next.id);
      await markFeedbackIncorporated(build.project_id, next.iteration);
    }
    return updated ?? next;
  } catch (e) {
    return (await updateBuild(next.id, { status: 'failed', metadata: { error: (e as Error).message } })) ?? next;
  }
}

/**
 * Poll an in-flight build to completion (and keep a live build's preview URL fresh —
 * v0's demoUrl carries an expiring token). Called by GET /builds/[buildId].
 */
export async function refreshBuild(build: MvpBuild): Promise<MvpBuild> {
  const builder = resolveBuilder(build.builder);
  if (!builder.getStatus || !build.builder_ref) return build;
  if (build.status !== 'building' && build.status !== 'live') return build;

  let res;
  try {
    res = await builder.getStatus({ projectId: build.project_id, buildId: build.id }, build.builder_ref);
  } catch {
    return build; // transient — leave the row as-is
  }

  const md = (build.metadata ?? {}) as Record<string, unknown>;
  const awaitAfter = md.awaitAfterVersion as string | undefined;

  // Already live: just refresh the (expiring) preview URL if it changed.
  if (build.status === 'live') {
    if (res.previewUrl && res.previewUrl !== build.preview_url) {
      return (await updateBuild(build.id, { previewUrl: res.previewUrl })) ?? build;
    }
    return build;
  }

  // Building: settle to live/failed, or keep waiting.
  const done = res.status === 'live' && (!awaitAfter || res.versionRef !== awaitAfter);
  const failed = res.status === 'failed';
  if (!done && !failed) {
    if (res.previewUrl && res.previewUrl !== build.preview_url) {
      return (await updateBuild(build.id, { previewUrl: res.previewUrl })) ?? build;
    }
    return build;
  }
  const updated = await updateBuild(build.id, {
    status: failed ? 'failed' : 'live',
    previewUrl: res.previewUrl ?? build.preview_url,
    liveAppUrl: res.liveUrl ?? build.live_app_url,
    metadata: { ...md, versionRef: res.versionRef ?? md.versionRef ?? null },
  });
  if (done) {
    await supersedeOtherBuilds(build.project_id, build.id);
    await markFeedbackIncorporated(build.project_id, build.iteration);
  }
  return updated ?? build;
}

/**
 * Cron sweep for in-flight builds. Runs every tick:
 *  (1) REAP — mark builds stuck 'building' past maxAgeMinutes as 'failed' (a
 *      killed serverless function, a driver crash, or a v0 phantom version can
 *      otherwise orphan a row in 'building' forever).
 *  (2) ADVANCE — poll the driver for still-'building' rows (settles the auto-
 *      iteration executor path and any build no client is polling).
 */
export async function sweepBuildingBuilds(opts?: {
  maxAgeMinutes?: number;
  limit?: number;
}): Promise<{ advanced: number; reaped: number }> {
  const maxAge = opts?.maxAgeMinutes ?? 12;
  const limit = opts?.limit ?? 20;

  const reaped = await run(
    `UPDATE mvp_builds
        SET status = 'failed', updated_at = CURRENT_TIMESTAMP,
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('error', ?)
      WHERE status = 'building' AND created_at < now() - make_interval(mins => ?)`,
    `Timed out — no completion after ${maxAge} minutes.`,
    maxAge,
  );

  const rows = await query<{ id: string }>(
    `SELECT id FROM mvp_builds WHERE status = 'building' ORDER BY created_at ASC LIMIT ?`,
    limit,
  );
  let advanced = 0;
  for (const r of rows) {
    try {
      const b = await getBuild(r.id);
      if (!b) continue;
      const nb = await refreshBuild(b);
      if (nb.status !== 'building') advanced++;
    } catch {
      /* transient driver error — next sweep */
    }
  }
  return { advanced, reaped: reaped.count };
}
