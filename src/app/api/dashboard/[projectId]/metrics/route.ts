import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const metrics = await query(
    'SELECT * FROM metrics WHERE project_id = ? ORDER BY created_at',
    projectId,
  );

  // Attach entries to each metric
  for (const metric of metrics) {
    const entries = await query(
      'SELECT * FROM metric_entries WHERE metric_id = ? ORDER BY date',
      metric.id,
    );
    metric.entries = entries;
  }

  return json(metrics);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();

  if (!body?.name || !body?.type) {return error('name and type are required');}

  const id = generateId('met');
  await run(
    `INSERT INTO metrics (id, project_id, name, type, target_growth_rate, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    body.name,
    body.type,
    body.target_growth_rate ?? 0.07,
    new Date().toISOString(),
  );

  const [metric] = await query('SELECT * FROM metrics WHERE id = ?', id);
  return json(metric, 201);
}
