import { NextRequest } from 'next/server';
import { query, get, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { calculateNextRun } from '@/lib/monitor-schedule';

interface MonitorRow {
  id: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  status: string;
  prompt: string | null;
  last_run: string | null;
  next_run: string | null;
  objective?: string | null;
  linked_quote?: string | null;
  urls_to_track?: string[] | string | null;
  kind?: string | null;
  created_at?: string;
}

interface AlertRow {
  id: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  created_at: string;
  monitor_run_id: string | null;
}

const VALID_SCHEDULES = new Set(['daily', 'weekly', 'monthly', 'manual']);
const VALID_STATUSES = new Set(['active', 'paused']);

/**
 * GET /api/projects/[projectId]/monitors/[monitorId]
 *
 * Single monitor detail + last 5 runs + alerts emitted by the latest run
 * + distinct source URLs cited by those alerts. Powers
 * /project/{id}/monitors/{monitorId}:
 *   title / objective / prompt / schedule / last run / logs / sources.
 *
 * Objective falls back to linked_quote when null — covers monitors
 * created before the objective column landed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const monitor = await get<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (!monitor) return error('Monitor not found', 404);

  const effectiveObjective = (monitor.objective ?? '').trim()
    || (monitor.linked_quote ?? '').trim()
    || null;

  // urls_to_track is JSONB; postgres.js parses jsonb to arrays, but legacy
  // rows may have stored a JSON string. Handle both.
  const urls = Array.isArray(monitor.urls_to_track)
    ? monitor.urls_to_track
    : typeof monitor.urls_to_track === 'string'
      ? safeParseStringArray(monitor.urls_to_track)
      : [];

  const recentRuns = await query<{ id: string; status: string; summary: string | null; alerts_generated: number; run_at: string }>(
    `SELECT id, status, summary, alerts_generated, run_at FROM monitor_runs
     WHERE monitor_id = ? AND project_id = ?
     ORDER BY run_at DESC LIMIT 5`,
    monitorId, projectId,
  );

  const lastRun = recentRuns[0] ?? null;

  let lastRunAlerts: AlertRow[] = [];
  let lastRunSources: string[] = [];
  if (lastRun) {
    lastRunAlerts = await query<AlertRow>(
      `SELECT id, headline, body, source_url, relevance_score, created_at, monitor_run_id
         FROM ecosystem_alerts
        WHERE project_id = ? AND monitor_run_id = ?
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT 50`,
      projectId, lastRun.id,
    );
    const sourceSet = new Set<string>();
    for (const a of lastRunAlerts) {
      if (a.source_url) sourceSet.add(a.source_url);
    }
    lastRunSources = Array.from(sourceSet);
  }

  return json({
    monitor: {
      ...monitor,
      objective: effectiveObjective,
      urls_to_track: urls,
    },
    recent_runs: recentRuns,
    last_run: lastRun,
    last_run_alerts: lastRunAlerts,
    last_run_sources: lastRunSources,
  });
}

function safeParseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * PATCH /api/projects/[projectId]/monitors/[monitorId]
 * Update schedule, status, name, or prompt.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;

  let body: Partial<{
    schedule: string;
    status: string;
    name: string;
    prompt: string;
  }>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  // Validate inputs
  if (body.schedule && !VALID_SCHEDULES.has(body.schedule)) {
    return error(`Invalid schedule: ${body.schedule}. Must be one of: ${[...VALID_SCHEDULES].join(', ')}`);
  }
  if (body.status && !VALID_STATUSES.has(body.status)) {
    return error(`Invalid status: ${body.status}. Must be active or paused`);
  }
  if (body.prompt && body.prompt.length > 5000) {
    return error('Prompt must be 5000 characters or less');
  }

  // Check monitor exists
  const existing = await query<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (existing.length === 0) {
    return error('Monitor not found', 404);
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name) { sets.push('name = ?'); values.push(body.name); }
  if (body.prompt !== undefined) { sets.push('prompt = ?'); values.push(body.prompt); }
  if (body.schedule) { sets.push('schedule = ?'); values.push(body.schedule); }
  if (body.status) { sets.push('status = ?'); values.push(body.status); }

  // Recalculate next_run based on new schedule/status
  const effectiveSchedule = body.schedule || existing[0].schedule;
  const effectiveStatus = body.status || existing[0].status;

  if (effectiveStatus === 'paused') {
    sets.push('next_run = ?');
    values.push(null);
  } else if (body.schedule || (body.status === 'active' && existing[0].status === 'paused')) {
    const nextRun = calculateNextRun(effectiveSchedule);
    sets.push('next_run = ?');
    values.push(nextRun);
  }

  if (sets.length === 0) {
    return error('No fields to update');
  }

  values.push(monitorId, projectId);
  await run(
    `UPDATE monitors SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`,
    ...values,
  );

  const updated = await query<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );

  return json(updated[0]);
}
