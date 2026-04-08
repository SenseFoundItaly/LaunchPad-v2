import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; alertId: string }> },
) {
  const { alertId } = await params;

  const rows = await query('SELECT id FROM alerts WHERE id = ?', alertId);
  if (rows.length === 0) {return error('Alert not found', 404);}

  await run('UPDATE alerts SET dismissed = true WHERE id = ?', alertId);
  return json(null);
}
