import { NextResponse } from 'next/server';
import { get, query } from '@/lib/db';

/**
 * GET /api/cron/health — public liveness endpoint for the heartbeat cron.
 *
 * Designed for external monitors (UptimeRobot, BetterUptime, GitHub Actions
 * cron, etc.) to ping on a separate cadence from the cron itself. This is the
 * dead-man's-switch — it's the only check that survives "the cron never
 * fired at all," because every other check we have lives inside the same
 * Postgres that the cron writes to.
 *
 * Returns 200 when:
 *   - The most recent `cron_runs.finished_at` (status='completed') is
 *     within MAX_AGE_MIN of now, AND
 *   - No `status='running'` row is older than MAX_STUCK_MIN (caught by
 *     the stuck-row sweep inside the cron handler, but we double-check
 *     here so the health endpoint never green-lights a broken state).
 *
 * Returns 503 otherwise, with a `reason` field describing which check
 * failed. No auth — this is intentionally pingable from anywhere so an
 * external monitor can reach it without secrets. It reads only aggregate
 * counts; no PII or project data leaks.
 *
 * Issue #19.
 */

const MAX_AGE_MIN = 30;     // last successful run must be within 30 minutes
const MAX_STUCK_MIN = 20;   // a 'running' row older than this is stuck

interface LastCompletedRow {
  finished_at: string;
}

interface StuckCountRow {
  n: number | string;
}

export async function GET() {
  const cutoffOld = new Date(Date.now() - MAX_AGE_MIN * 60 * 1000).toISOString();
  const cutoffStuck = new Date(Date.now() - MAX_STUCK_MIN * 60 * 1000).toISOString();

  let lastCompleted: LastCompletedRow | null = null;
  let stuck = 0;
  try {
    [lastCompleted, stuck] = await Promise.all([
      get<LastCompletedRow>(
        `SELECT finished_at FROM cron_runs
          WHERE status = 'completed' AND finished_at IS NOT NULL
          ORDER BY finished_at DESC LIMIT 1`,
      ).then((r) => r ?? null),
      query<StuckCountRow>(
        `SELECT COUNT(*) AS n FROM cron_runs
          WHERE status = 'running' AND started_at < ?`,
        cutoffStuck,
      ).then((rows) => Number(rows[0]?.n ?? 0)),
    ]);
  } catch (err) {
    // If even the health query fails, the system is in a bad state — fail
    // loud rather than silently 200.
    return NextResponse.json(
      { ok: false, reason: 'health-query-failed', detail: (err as Error).message },
      { status: 503 },
    );
  }

  // Check 1 — was there ever a completed run?
  if (!lastCompleted) {
    return NextResponse.json(
      { ok: false, reason: 'no-completed-runs-ever' },
      { status: 503 },
    );
  }

  // Check 2 — was the most recent completed run recent enough?
  const lastMs = new Date(lastCompleted.finished_at).getTime();
  if (lastMs < new Date(cutoffOld).getTime()) {
    const ageMin = Math.round((Date.now() - lastMs) / 60_000);
    return NextResponse.json(
      {
        ok: false,
        reason: 'stale',
        last_completed_at: lastCompleted.finished_at,
        age_minutes: ageMin,
        threshold_minutes: MAX_AGE_MIN,
      },
      { status: 503 },
    );
  }

  // Check 3 — are there any stuck running rows?
  if (stuck > 0) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'stuck-runs',
        stuck_count: stuck,
        threshold_minutes: MAX_STUCK_MIN,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    last_completed_at: lastCompleted.finished_at,
    age_minutes: Math.round((Date.now() - lastMs) / 60_000),
  });
}
