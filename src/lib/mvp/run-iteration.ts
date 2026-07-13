// ============================================================================
// Auto-iteration executor helper.
//
// On approve of an `mvp_build_iteration` action, derive the change message from
// accumulated feedback and kick off an ASYNC iteration (startIteration → a new
// 'building' row) — NO blocking LLM skill on the critical path, so the approve
// request survives Netlify's function limit. The cron sweep / a founder opening
// /build settles the 'building' row to live via the poller.
//
// (assertBuildAllowed cost-gating happens up-front inside startIteration.)
// ============================================================================

import { type MvpBuild, listPendingFeedback } from './mvp-builds';
import { startIteration } from './build-runner';

const MAX = 50_000;

/** Draft a change message from accumulated feedback and kick off an async iteration. */
export async function generateAndApplyIteration(build: MvpBuild): Promise<MvpBuild> {
  const pending = await listPendingFeedback(build.project_id);
  const message = pending.length
    ? `Apply these changes based on accumulated user feedback:\n${pending.map((f) => `- ${f.body}`).join('\n')}`
    : 'Refine and polish the app based on the latest project intelligence.';
  return startIteration(build, message.slice(0, MAX));
}
