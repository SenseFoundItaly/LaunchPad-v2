import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
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
}

const VALID_SCHEDULES = new Set(['hourly', 'daily', 'weekly', 'monthly', 'manual']);
const VALID_STATUSES = new Set(['active', 'paused']);

/**
 * GET /api/projects/[projectId]/monitors/[monitorId]
 * Single monitor detail + last 5 runs.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;

  const monitors = await query<MonitorRow>(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId, projectId,
  );
  if (monitors.length === 0) {
    return error('Monitor not found', 404);
  }

  const runs = await query<{ id: string; status: string; summary: string | null; run_at: string }>(
    `SELECT id, status, summary, run_at FROM monitor_runs
     WHERE monitor_id = ? AND project_id = ?
     ORDER BY run_at DESC LIMIT 5`,
    monitorId, projectId,
  );

  return json({ monitor: monitors[0], recent_runs: runs });
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
