import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

/** GET: list all skill completions for a project */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rows = query(
    'SELECT * FROM skill_completions WHERE project_id = ? ORDER BY completed_at DESC',
    projectId,
  );
  return json(rows);
}

/** POST: mark a skill as completed */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();
  if (!body?.skill_id) return error('skill_id required');

  const id = generateId('skc');
  run(
    `INSERT INTO skill_completions (id, project_id, skill_id, status, summary, completed_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, skill_id) DO UPDATE SET
       status = excluded.status,
       summary = excluded.summary,
       completed_at = excluded.completed_at`,
    id,
    projectId,
    body.skill_id,
    body.status || 'completed',
    body.summary || null,
    new Date().toISOString(),
  );

  return json({ id, skill_id: body.skill_id, status: 'completed' }, 201);
}
