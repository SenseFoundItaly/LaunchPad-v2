import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const id = generateId('upd');
  await run(
    `INSERT INTO startup_updates (id, project_id, period, metrics_snapshot, highlights, challenges, asks, morale, generated_summary, date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    body.period || '',
    JSON.stringify(body.metrics_snapshot || []),
    JSON.stringify(body.highlights || []),
    JSON.stringify(body.challenges || []),
    JSON.stringify(body.asks || []),
    body.morale || null,
    body.generated_summary || null,
    new Date().toISOString().split('T')[0],
  );

  const [update] = await query('SELECT * FROM startup_updates WHERE id = ?', id);
  return json(update, 201);
}
