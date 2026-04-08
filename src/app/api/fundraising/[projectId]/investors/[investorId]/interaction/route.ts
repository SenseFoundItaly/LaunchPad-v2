import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  const { investorId } = await params;
  const body = await request.json();

  if (!body?.type) {return error('type is required');}

  const invRows = await query('SELECT id FROM investors WHERE id = ?', investorId);
  if (invRows.length === 0) {return error('Investor not found', 404);}

  const id = generateId('int');
  await run(
    `INSERT INTO investor_interactions (id, investor_id, type, summary, next_step, next_step_date, date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    investorId,
    body.type,
    body.notes || body.summary || '',
    body.follow_up || body.next_step || '',
    body.next_step_date || null,
    body.date || new Date().toISOString().split('T')[0],
  );

  const [interaction] = await query('SELECT * FROM investor_interactions WHERE id = ?', id);
  return json(interaction, 201);
}
