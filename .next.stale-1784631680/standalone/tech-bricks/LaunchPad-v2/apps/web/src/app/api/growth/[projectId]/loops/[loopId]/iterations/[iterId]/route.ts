import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string; iterId: string }> },
) {
  const { iterId } = await params;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const rows = await query('SELECT id FROM growth_iterations WHERE id = ?', iterId);
  if (rows.length === 0) {return error('Iteration not found', 404);}

  const fields: string[] = [];
  const values: unknown[] = [];

  if ('result_value' in body) {
    fields.push('result_value = ?', 'status = ?');
    values.push(body.result_value, 'completed');
  }
  if ('adopted' in body) {
    fields.push('adopted = ?');
    values.push(body.adopted);
  }
  if ('improvement_pct' in body) {
    fields.push('improvement_pct = ?');
    values.push(body.improvement_pct);
  }
  if ('learnings' in body) {
    fields.push('learnings = ?');
    values.push(body.learnings);
  }

  if (fields.length > 0) {
    values.push(iterId);
    await run(`UPDATE growth_iterations SET ${fields.join(', ')} WHERE id = ?`, ...values);
  }

  const [iteration] = await query('SELECT * FROM growth_iterations WHERE id = ?', iterId);
  return json(iteration);
}
