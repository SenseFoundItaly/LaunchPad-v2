import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const rows = await query(
    'SELECT * FROM alerts WHERE project_id = ? AND dismissed = false ORDER BY created_at DESC',
    projectId,
  );
  return json(rows);
}
