/**
 * Founder-facing WEEKLY credit estimate for a watcher, by cadence.
 *
 * Mirrors the server estimator (project-tools.ts → estimateMonitorCredits): a
 * watcher run is a balanced web-browse + synthesis pass, priced per run, times
 * the runs/week the cadence implies. Pure + client-safe (no DB), so both the
 * agent's MonitorProposalCard and the founder's NewWatcherForm show the same
 * number before a watcher is ever created.
 */

const RUNS_PER_WEEK: Record<string, number> = {
  hourly: 168,
  daily: 7,
  weekly: 1,
  monthly: 0.25,
};

export function watcherRunsPerWeek(cadence: string): number {
  return RUNS_PER_WEEK[cadence] ?? 1;
}

// Default per-run credit cost when the per-project estimate isn't known
// (e.g. the manual form). ≈ BALANCED_COST_PER_RUN_EUR (0.0055) × the default
// ~100 credits/EUR. The MonitorProposalCard passes the artifact's real
// estimated_per_run_credits instead when present.
export const DEFAULT_WATCHER_PER_RUN_CREDITS = 0.55;

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
