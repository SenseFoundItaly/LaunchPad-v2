// ============================================================================
// Auto-iteration executor helper.
//
// On approve of an `mvp_build_iteration` action, synthesize the change message
// and kick off an ASYNC iteration (startIteration → a new 'building' row) — NO
// blocking LLM skill on the critical path, so the approve request survives
// Netlify's function limit. The cron sweep / a founder opening the Build tab
// settles the 'building' row to live via the poller.
//
// Preferred path (#270): the proposal payload carries a feature-shaped ISSUE
// cluster — implement exactly that cluster (deterministic synthesis from the
// already-actionable issue titles; no LLM needed) and thread the issue ids into
// the new build so the settle path marks them shipped. Fallback: bullet-join
// raw pending feedback (pre-issue rows / classifier fail-open).
//
// (assertBuildAllowed cost-gating happens up-front inside startIteration.)
// ============================================================================

import { type MvpBuild, listPendingFeedback } from './mvp-builds';
import { getIssues } from './build-issues';
import { startIteration } from './build-runner';

const MAX = 50_000;

export interface IterationPlan {
  issueIds?: string[];
  feature?: string;
}

/** Synthesize the change message and kick off an async iteration. */
export async function generateAndApplyIteration(
  build: MvpBuild,
  plan?: IterationPlan,
): Promise<MvpBuild> {
  let message: string | null = null;
  let issueIds: string[] = [];

  if (plan?.issueIds?.length) {
    const issues = await getIssues(build.project_id, plan.issueIds);
    if (issues.length > 0) {
      issueIds = issues.map((i) => i.id);
      const area = plan.feature ?? issues[0].feature;
      message = `Improve the ${area} area of the app. Apply ALL of these changes:\n${issues
        .map((i) => `- ${i.title}`)
        .join('\n')}`;
    }
  }

  if (!message) {
    const pending = await listPendingFeedback(build.project_id);
    message = pending.length
      ? `Apply these changes based on accumulated user feedback:\n${pending.map((f) => `- ${f.body}`).join('\n')}`
      : 'Refine and polish the app based on the latest project intelligence.';
  }

  return startIteration(build, message.slice(0, MAX), undefined, { issueIds });
}
