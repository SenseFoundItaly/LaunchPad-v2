import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; msId: string }> },
) {
  const { msId } = await params;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const rows = await query('SELECT id FROM milestones WHERE id = ?', msId);
  if (rows.length === 0) {return error('Milestone not found', 404);}

  const fields: string[] = [];
  const values: unknown[] = [];
  for (const key of ['status', 'title', 'description', 'linked_feature', 'completed_at']) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(body[key]);
    }
  }

  if (fields.length > 0) {
    values.push(msId);
    await run(`UPDATE milestones SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  const [milestone] = await query('SELECT * FROM milestones WHERE id = ?', msId);
  return json(milestone);
}
