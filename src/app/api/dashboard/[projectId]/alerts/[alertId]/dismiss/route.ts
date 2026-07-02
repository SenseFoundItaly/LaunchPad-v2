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

  // SECURITY: scope the alert to the URL project (cross-project IDOR).
  const rows = await query('SELECT id FROM alerts WHERE id = ? AND project_id = ?', alertId, projectId);
  if (rows.length === 0) {return error('Alert not found', 404);}

  await run('UPDATE alerts SET dismissed = true WHERE id = ? AND project_id = ?', alertId, projectId);
  return json(null);
}
