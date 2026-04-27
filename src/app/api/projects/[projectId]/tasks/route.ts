import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { query } from '@/lib/db';

/**
 * GET /api/projects/{projectId}/tasks
 *
 * Returns active founder tasks (action_type='task'), grouped-ready by priority.
 * Powers the Canvas → Tasks tab in /project/[projectId]/chat.
 *
 * Query: ?status=pending,edited (default: pending+edited — i.e. open).
 */

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  rationale: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  priority: string | null;
  sources: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES = new Set(['pending', 'edited', 'approved', 'sent', 'rejected', 'failed']);

function safeJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const statuses = statusParam
    ? statusParam.split(',').map(s => s.trim()).filter(s => VALID_STATUSES.has(s))
    : ['pending', 'edited'];

  if (statuses.length === 0) {
    return json({ tasks: [], counts: { critical: 0, high: 0, medium: 0, low: 0 } });
  }

  const placeholders = statuses.map(() => '?').join(',');
  const rows = await query<TaskRow>(
    `SELECT id, project_id, title, rationale, payload, status, priority, sources, created_at, updated_at
     FROM pending_actions
     WHERE project_id = ?
       AND action_type = 'task'
       AND status IN (${placeholders})
     ORDER BY
       CASE priority
         WHEN 'critical' THEN 1
         WHEN 'high'     THEN 2
         WHEN 'medium'   THEN 3
         WHEN 'low'      THEN 4
         ELSE 5
       END,
       created_at DESC
     LIMIT 200`,
    projectId,
    ...statuses,
  );

  const tasks = rows.map((r) => {
    const payload = r.payload || {};
    return {
      id: r.id,
      project_id: r.project_id,
      title: r.title,
      description: r.rationale,
      priority: r.priority || 'medium',
      due: typeof payload.due === 'string' ? payload.due : null,
      client_artifact_id: typeof payload.client_artifact_id === 'string' ? payload.client_artifact_id : null,
      snooze_until: typeof payload.snooze_until === 'string' ? payload.snooze_until : null,
      status: r.status,
      sources: safeJson<unknown[]>(r.sources) || [],
      // Phase G — expansion fields surfaced from payload so the Tasks tab
      // shows the same expanded breakdown that the chat-inline TaskCard does.
      // Old rows have neither key → both fall through as null/[] cleanly.
      details: typeof payload.details === 'string' ? payload.details : null,
      subtasks: Array.isArray(payload.subtasks) ? payload.subtasks : [],
      references: Array.isArray(payload.references) ? payload.references : [],
      estimated_effort: typeof payload.estimated_effort === 'string' ? payload.estimated_effort : null,
      expanded_at: typeof payload.expanded_at === 'string' ? payload.expanded_at : null,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of tasks) {
    if (t.priority === 'critical') counts.critical++;
    else if (t.priority === 'high') counts.high++;
    else if (t.priority === 'low') counts.low++;
    else counts.medium++;
  }

  return json({ tasks, counts });
}
