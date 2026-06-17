/**
 * Founder-facing WEEKLY credit estimate for a watcher, by cadence.
 *
 * Mirrors the server estimator (project-tools.ts → estimateMonitorCredits): a
 * watcher run is a balanced web-browse + synthesis pass, priced per run, times
 * the runs/week the cadence implies. Pure + client-safe (no DB), so both the
 * agent's MonitorProposalCard and the founder's NewWatcherForm show the same
 * number before a watcher is ever created.
 */

import { USER_MONTHLY_CREDITS, USER_MONTHLY_LLM_USD } from '@/lib/credit-costs';

const RUNS_PER_WEEK: Record<string, number> = {
  hourly: 168,
  daily: 7,
  weekly: 1,
  monthly: 0.25,
};

export function watcherRunsPerWeek(cadence: string): number {
  return RUNS_PER_WEEK[cadence] ?? 1;
}

// Default per-run credit cost when the per-project estimate isn't known (e.g.
// the manual form). Empirical monitor-agent base cost (~$0.0055/run: system
// prompt + web_search + alert parsing) × the CANONICAL post-markup ratio
// (3× markup, 2026-06-16: 100 credits / $0.333 = 300 credits per $). Was 0.55,
// derived from a stale ~100 credits/$ that predated the markup — so watcher
// estimates read ~3× too low. The MonitorProposalCard passes the artifact's
// real estimated_per_run_credits when present.
const BALANCED_COST_PER_RUN_USD = 0.0055;
const CREDITS_PER_DOLLAR =
  USER_MONTHLY_LLM_USD > 0 ? USER_MONTHLY_CREDITS / USER_MONTHLY_LLM_USD : 300;
export const DEFAULT_WATCHER_PER_RUN_CREDITS = +(BALANCED_COST_PER_RUN_USD * CREDITS_PER_DOLLAR).toFixed(2);

/**
 * Founder-facing cost of ONE manual run ("Run now"): a single scan = one
 * per-run charge, independent of cadence. Floor of 1 credit when there's any
 * cost. Shown on the Run-now button so the spend is consented before the click.
 */
export function watcherRunLabel(perRunCredits?: number): string {
  const perRun =
    typeof perRunCredits === 'number' && perRunCredits > 0
      ? perRunCredits
      : DEFAULT_WATCHER_PER_RUN_CREDITS;
  const n = Math.max(1, Math.round(perRun));
  return `≈ ${n} credit${n === 1 ? '' : 's'}`;
}

export function watcherWeeklyCredits(cadence: string, perRunCredits?: number): number {
  const perRun =
    typeof perRunCredits === 'number' && perRunCredits > 0
      ? perRunCredits
      : DEFAULT_WATCHER_PER_RUN_CREDITS;
  return watcherRunsPerWeek(cadence) * perRun;
}

/**
 * Founder-facing label: "≈ 4 credits/week". Rounds to a whole credit with a
 * floor of 1 whenever there's any cost — sub-credit precision ("0.6 credits")
 * reads as noise to a founder; the real spend is metered per run regardless.
 */
export function watcherWeeklyLabel(cadence: string, perRunCredits?: number): string {
  const weekly = watcherWeeklyCredits(cadence, perRunCredits);
  if (weekly <= 0) return 'negligible';
  const n = Math.max(1, Math.round(weekly));
  return `≈ ${n} credit${n === 1 ? '' : 's'}/week`;
}
