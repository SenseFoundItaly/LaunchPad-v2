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
  const loops = await query(
    'SELECT * FROM growth_loops WHERE project_id = ? ORDER BY created_at',
    projectId,
  );
  return json(loops);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const authPost = await tryProjectAccess(projectId);
  if (!authPost.ok) return authPost.response;
  const body = await request.json();

  if (!body?.metric_name || !body?.optimization_target) {
    return error('metric_name and optimization_target are required');
  }

  const id = generateId('loop');
  await run(
    `INSERT INTO growth_loops (id, project_id, metric_name, optimization_target, status, baseline_value, created_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    id,
    projectId,
    body.metric_name,
    body.optimization_target,
    body.baseline_value ?? null,
    new Date().toISOString(),
  );

  const [loop] = await query('SELECT * FROM growth_loops WHERE id = ?', id);
  return json(loop, 201);
}
