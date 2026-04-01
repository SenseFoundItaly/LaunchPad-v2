import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const step = searchParams.get('step') || 'idea';

  if (!projectId) {return error('project_id required');}

  const rows = await query(
    'SELECT * FROM chat_messages WHERE project_id = ? AND step = ? ORDER BY timestamp',
    projectId,
    step,
  );
  return json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.project_id) {return error('project_id required');}

  const { project_id, step = 'idea', messages = [] } = body;

  for (const msg of messages) {
    const id = generateId('msg');
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      project_id,
      step,
      msg.role,
      msg.content,
      new Date().toISOString(),
    );
  }

  return json(null);
}
