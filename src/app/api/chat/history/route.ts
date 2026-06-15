import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('project_id');
  const step = searchParams.get('step') || 'chat';

  if (!projectId) {return error('project_id required');}
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  // ORDER BY "timestamp" alone is a PARTIAL order: a turn's user + assistant
  // rows are persisted with the SAME timestamp (see /api/chat persist block), so
  // ties resolve in arbitrary heap order and the pair flips across refreshes.
  // The role tiebreaker (user before assistant) restores a deterministic total
  // order — and repairs threads already persisted with colliding timestamps,
  // since turns are seconds apart so the only ties are within a single pair.
  const rows = await query(
    `SELECT * FROM chat_messages WHERE project_id = ? AND step = ?
     ORDER BY "timestamp", CASE role WHEN 'user' THEN 0 WHEN 'assistant' THEN 1 ELSE 2 END`,
    projectId,
    step,
  );
  return json(rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  if (!body?.project_id) {return error('project_id required');}
  const authPost = await tryProjectAccess(body.project_id);
  if (!authPost.ok) return authPost.response;

  const { project_id, step = 'chat', messages = [] } = body;

  // Replace: delete existing then insert current set
  await run('DELETE FROM chat_messages WHERE project_id = ? AND step = ?', project_id, step);

  for (const msg of messages) {
    const id = generateId('msg');
    await run(
      `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp")
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
