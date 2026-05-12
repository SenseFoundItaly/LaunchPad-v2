import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; alertId: string }> },
) {
  const { projectId, alertId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query('SELECT id FROM alerts WHERE id = ?', alertId);
  if (rows.length === 0) {return error('Alert not found', 404);}

  await run('UPDATE alerts SET dismissed = true WHERE id = ?', alertId);
  return json(null);
}
