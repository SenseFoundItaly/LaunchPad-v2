import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const body = await request.json();
  if (!body) {return error('Request body required');}

  const id = generateId('ts');
  await run(
    `INSERT INTO term_sheets (id, project_id, investor_id, valuation, amount, instrument, key_terms, status, notes, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    projectId,
    body.investor_id || null,
    body.valuation || null,
    body.amount || null,
    body.instrument || '',
    body.key_terms || JSON.stringify(body.terms || {}),
    body.status || 'received',
    body.notes || body.investor_name || '',
    body.received_date || new Date().toISOString(),
  );

  const [ts] = await query('SELECT * FROM term_sheets WHERE id = ?', id);
  return json(ts, 201);
}
