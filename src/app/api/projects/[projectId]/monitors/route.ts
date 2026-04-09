import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

function mapMonitor(row: Record<string, unknown>) {
  const { id, ...rest } = row;
  return { monitor_id: id, ...rest };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const monitors = query(
    'SELECT * FROM monitors WHERE project_id = ? ORDER BY created_at',
    projectId,
  );
  return json(monitors.map(mapMonitor));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();

  if (!body?.name || !body?.prompt) {
    return error('name and prompt are required');
  }

  const id = generateId('mon');
  const now = new Date().toISOString();
  const schedule = body.schedule || 'weekly';

  // Calculate next run based on schedule
  const nextRun = calculateNextRun(schedule);

  run(
    `INSERT INTO monitors (id, project_id, name, type, prompt, schedule, enabled, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    body.name,
    body.type || 'health',
    body.prompt,
    schedule,
    true,
    nextRun,
    now,
    now,
  );

  const [monitor] = query('SELECT * FROM monitors WHERE id = ?', id);
  return json(mapMonitor(monitor), 201);
}

function calculateNextRun(schedule: string): string {
  const now = new Date();
  switch (schedule) {
    case 'daily':
      now.setDate(now.getDate() + 1);
      break;
    case 'weekly':
      now.setDate(now.getDate() + 7);
      break;
    case 'biweekly':
      now.setDate(now.getDate() + 14);
      break;
    case 'monthly':
      now.setMonth(now.getMonth() + 1);
      break;
    default:
      now.setDate(now.getDate() + 7);
  }
  return now.toISOString();
}
