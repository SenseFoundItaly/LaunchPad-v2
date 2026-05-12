import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; investorId: string }> },
) {
  const { projectId, investorId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = await request.json();

  if (!body?.stage) {return error('stage is required');}

  const rows = await query('SELECT id FROM investors WHERE id = ?', investorId);
  if (rows.length === 0) {return error('Investor not found', 404);}

  await run(
    'UPDATE investors SET stage = ?, updated_at = ? WHERE id = ?',
    body.stage,
    new Date().toISOString(),
    investorId,
  );

  const [investor] = await query('SELECT * FROM investors WHERE id = ?', investorId);
  return json(investor);
}
