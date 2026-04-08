import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string }> },
) {
  const { loopId } = await params;

  const loops = await query('SELECT * FROM growth_loops WHERE id = ?', loopId);
  if (loops.length === 0) {return error('Loop not found', 404);}

  const iterations = await query(
    'SELECT * FROM growth_iterations WHERE loop_id = ? ORDER BY created_at',
    loopId,
  );

  const loop = loops[0];
  loop.iterations = iterations;
  return json(loop);
}
