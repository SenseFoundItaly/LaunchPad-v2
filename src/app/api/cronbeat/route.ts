import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

interface CronRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  duration_ms: number | null;
  monitors_ran: number;
  watch_sources_processed: number;
  correlations_ran: number;
  heartbeats_ran: number;
  notifications_dismissed: number;
  error_message: string | null;
}

type HealthStatus = 'healthy' | 'stale' | 'dead';

/**
 * GET /api/cronbeat
 * Returns cron health status based on recent cron_runs.
 *
 * Health logic:
 * - healthy: last successful finished_at < 26h ago
 * - stale: 26–50h (missed one daily cycle)
 * - dead: >50h or no runs at all
 * - running rows older than 15min are treated as failed (timeout)
 */
export async function GET() {
  const recentRuns = await query<CronRunRow>(
    `SELECT id, started_at, finished_at, status, duration_ms,
            monitors_ran, watch_sources_processed, correlations_ran,
            heartbeats_ran, notifications_dismissed, error_message
     FROM cron_runs
     ORDER BY started_at DESC
     LIMIT 5`,
  );

  // Mark stuck "running" rows (older than 15 min) as effectively failed
  const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
  const effectiveRuns = recentRuns.map(r => {
    if (r.status === 'running' && new Date(r.started_at).getTime() < fifteenMinAgo) {
      return { ...r, status: 'timeout' };
    }
    return r;
  });

  // Find last successful run
  const lastSuccessful = effectiveRuns.find(r => r.status === 'completed');
  const lastRun = effectiveRuns[0] || null;

  let health: HealthStatus;
  let hoursSinceLast: number | null = null;

  if (!lastSuccessful) {
    health = 'dead';
  } else {
    const finishedAt = lastSuccessful.finished_at
      ? new Date(lastSuccessful.finished_at).getTime()
      : new Date(lastSuccessful.started_at).getTime();
    const hoursSince = (Date.now() - finishedAt) / (1000 * 60 * 60);
    hoursSinceLast = Math.round(hoursSince * 10) / 10;

    if (hoursSince < 26) {
      health = 'healthy';
    } else if (hoursSince < 50) {
      health = 'stale';
    } else {
      health = 'dead';
    }
  }

  return json({
    last_run: lastRun,
    health,
    hours_since_last: hoursSinceLast,
    recent_runs: effectiveRuns,
  });
}
