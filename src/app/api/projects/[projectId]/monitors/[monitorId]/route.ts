import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

function mapMonitor(row: Record<string, unknown>) {
  const { id, ...rest } = row;
  return { monitor_id: id, ...rest };
}

function mapRun(row: Record<string, unknown>) {
  const { id, ...rest } = row;
  return { run_id: id, ...rest };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;

  const monitor = get(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId,
    projectId,
  );

  if (!monitor) {
    return error('Monitor not found', 404);
  }

  // Fetch recent runs (last 10)
  const runs = query(
    'SELECT * FROM monitor_runs WHERE monitor_id = ? ORDER BY started_at DESC LIMIT 10',
    monitorId,
  );

  return json({
    ...mapMonitor(monitor),
    recent_runs: runs.map(mapRun),
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;
  const body = await request.json();

  const existing = get(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId,
    projectId,
  );

  if (!existing) {
    return error('Monitor not found', 404);
  }

  const now = new Date().toISOString();
  run(
    `UPDATE monitors SET
       name = COALESCE(?, name),
       prompt = COALESCE(?, prompt),
       schedule = COALESCE(?, schedule),
       enabled = COALESCE(?, enabled),
       updated_at = ?
     WHERE id = ? AND project_id = ?`,
    body.name ?? null,
    body.prompt ?? null,
    body.schedule ?? null,
    body.enabled ?? null,
    now,
    monitorId,
    projectId,
  );

  const updated = get('SELECT * FROM monitors WHERE id = ?', monitorId);
  return json(mapMonitor(updated!));
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; monitorId: string }> },
) {
  const { projectId, monitorId } = await params;

  const existing = get(
    'SELECT * FROM monitors WHERE id = ? AND project_id = ?',
    monitorId,
    projectId,
  );

  if (!existing) {
    return error('Monitor not found', 404);
  }

  // Delete associated data first
  run('DELETE FROM monitor_alerts WHERE monitor_id = ?', monitorId);
  run('DELETE FROM monitor_runs WHERE monitor_id = ?', monitorId);
  run('DELETE FROM monitors WHERE id = ?', monitorId);

  return json({ deleted: true });
}
