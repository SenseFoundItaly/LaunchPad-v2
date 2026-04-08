import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rows = await query('SELECT * FROM simulation WHERE project_id = ?', projectId);
  return json(rows.length > 0 ? rows[0] : null);
}
