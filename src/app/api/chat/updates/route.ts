import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

/**
 * GET /api/chat/updates?project_id=…&step=chat&since=<ISO>
 *
 * Nanocorp live delivery: server-authored assistant messages (agent
 * narrations, loop verdicts, skill answers) written since `since`. The
 * `meta ? 'server_authored'` filter is the own-turn exclusion — the live-turn
 * persist in /api/chat never sets it, so a founder's just-streamed reply can
 * never be returned (and duplicated) by this poll.
 *
 * Polled ~12s by the chat page while visible (useAgentUpdates in useChat.ts).
 * One indexed SELECT; bounded.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('project_id') || '';
  const step = url.searchParams.get('step') || 'chat';
  const since = url.searchParams.get('since') || '';
  if (!projectId) return error('project_id is required', 400);
  if (!since || Number.isNaN(Date.parse(since))) return error('since (ISO timestamp) is required', 400);

  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query<{
    id: string; role: string; content: string; timestamp: string; meta: Record<string, unknown> | null;
  }>(
    `SELECT id, role, content, "timestamp", meta
       FROM chat_messages
      WHERE project_id = ? AND step = ? AND role = 'assistant'
        AND meta->>'server_authored' = 'true'
        AND "timestamp" > ?
      ORDER BY "timestamp" ASC
      LIMIT 50`,
    projectId, step, since,
  );
  return json({ messages: rows });
}
