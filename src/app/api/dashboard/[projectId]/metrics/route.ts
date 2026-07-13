import { NextRequest } from 'next/server';
import { query, run, get } from '@/lib/db';
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

  // Upsert on (project_id, name): there is no DB unique constraint on the pair
  // (the chat update_metrics tool dedups the same way, project-tools.ts), and
  // the stage-7 metrics_tracked gate counts distinct names — so a blind insert
  // of a repeated name would create redundant rows. Match on name, update the
  // existing row's type/target else insert.
  const existing = await get<{ id: string }>(
    'SELECT id FROM metrics WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1',
    projectId,
    body.name,
  );
  let id: string;
  if (existing) {
    id = existing.id;
    await run(
      'UPDATE metrics SET type = ?, target_growth_rate = ? WHERE id = ?',
      body.type,
      body.target_growth_rate ?? 0.07,
      id,
    );
  } else {
    id = generateId('met');
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
  }

  const [metric] = await query('SELECT * FROM metrics WHERE id = ?', id);
  return json(metric, existing ? 200 : 201);
}
