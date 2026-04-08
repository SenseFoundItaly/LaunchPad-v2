import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const step = searchParams.get('step') || 'chat';

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

  const { project_id, step = 'chat', messages = [] } = body;

  // Replace: delete existing then insert current set
  run('DELETE FROM chat_messages WHERE project_id = ? AND step = ?', project_id, step);

  for (const msg of messages) {
    const id = generateId('msg');
    run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, timestamp)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      project_id,
      step,
      msg.role,
      msg.content,
      msg.timestamp || new Date().toISOString(),
    );
  }

  return json(null);
}
