import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; metricId: string }> },
) {
  const { projectId, metricId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();

  if (!body || body.value === undefined || body.value === null) {
    return error('value is required');
  }

  // Verify metric exists
  const metrics = await query('SELECT id FROM metrics WHERE id = ?', metricId);
  if (metrics.length === 0) {return error('Metric not found', 404);}

  const id = generateId('ent');
  await run(
    `INSERT INTO metric_entries (id, metric_id, date, value, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    metricId,
    body.date || new Date().toISOString().split('T')[0],
    body.value,
    body.notes || '',
    new Date().toISOString(),
  );

  const [entry] = await query('SELECT * FROM metric_entries WHERE id = ?', id);
  return json(entry, 201);
}
