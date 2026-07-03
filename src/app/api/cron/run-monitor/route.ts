import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { error } from '@/lib/api-helpers';
import { requireCronAuth } from '@/lib/cron-auth';
import { streamMonitorRun } from '@/lib/monitor-run-stream';

// A monitor agent run takes 60–180s. This endpoint STREAMS (via
// streamMonitorRun's SSE ReadableStream), and a consumed stream keeps the
// serverless function alive for the full run — the same path that completes
// 10/10 as the founder-facing "Run now". The GitHub Actions scheduler calls
// this once per due monitor (curl -N) so each run finishes; /api/cron itself
// only returns the due IDs and never runs monitors inline (Netlify would kill
// the function mid-run). maxDuration is honored on Vercel; on Netlify the
// streaming response is what actually extends the run.
export const maxDuration = 300;

/**
 * GET /api/cron/run-monitor?monitor_id=<id>  (CRON_SECRET bearer)
 *
 * Streams a single monitor scan to completion. CRON_SECRET-authed (not a
 * session) so the scheduler can drive it; no cross-tenant risk because the
 * monitor id fully determines its project.
 */
export async function GET(request: NextRequest) {
  const auth = requireCronAuth(request);
  if (!auth.ok) return auth.response;

  const monitorId = new URL(request.url).searchParams.get('monitor_id');
  if (!monitorId) return error('monitor_id is required', 400);

  const monitor = await get<{ project_id: string }>(
    "SELECT project_id FROM monitors WHERE id = ? AND status = 'active'",
    monitorId,
  );
  if (!monitor) return error('Active monitor not found', 404);

  // streamMonitorRun writes the monitor_run row + ecosystem_alerts and advances
  // last_run/next_run on completion, so the monitor drops out of the due set.
  return streamMonitorRun(monitor.project_id, monitorId);
}
