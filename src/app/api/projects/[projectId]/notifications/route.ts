import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { typesForLane } from '@/lib/pending-actions';

/**
 * GET /api/projects/{projectId}/notifications
 *
 * Returns open notification-lane pending_actions — things the SYSTEM finished
 * that the founder just acknowledges (today: `skill_rerun_result` rows
 * produced when the heartbeat executor refreshes a stale analytical skill).
 *
 * Phase 1 of the 4-bucket reorganization. Powers the "Notifications" tab in
 * /project/[projectId]/actions. Also used by the cron auto-dismiss step to
 * count stale rows that are eligible for expiry.
 *
 * Query: ?status=pending,edited (default: pending+edited).
 */

interface ActionRow {
  id: string;
  project_id: string;
  title: string;
  rationale: string | null;
  payload: Record<string, unknown> | null;
  action_type: string;
  status: string;
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
    ? statusParam.split(',').map((s) => s.trim()).filter((s) => VALID_STATUSES.has(s))
    : ['pending', 'edited'];

  if (statuses.length === 0) {
    return json({ notifications: [], counts: { total: 0, by_type: {} } });
  }

  const notificationTypes = typesForLane('notification');
  // Defensive: if the lane is empty (shouldn't happen — skill_rerun_result is
  // in it), short-circuit to avoid emitting `IN ()` which is a SQL error.
  if (notificationTypes.length === 0) {
    return json({ notifications: [], counts: { total: 0, by_type: {} } });
  }

  const statusPlaceholders = statuses.map(() => '?').join(',');
  const typePlaceholders = notificationTypes.map(() => '?').join(',');

  const rows = await query<ActionRow>(
    `SELECT id, project_id, title, rationale, payload, action_type, status, sources,
            created_at, updated_at
     FROM pending_actions
     WHERE project_id = ?
       AND action_type IN (${typePlaceholders})
       AND status IN (${statusPlaceholders})
     ORDER BY created_at DESC
     LIMIT 200`,
    projectId,
    ...notificationTypes,
    ...statuses,
  );

  const notifications = rows.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    rationale: r.rationale,
    action_type: r.action_type,
    status: r.status,
    payload: r.payload || {},
    sources: safeJson<unknown[]>(r.sources) || [],
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const by_type: Record<string, number> = {};
  for (const n of notifications) by_type[n.action_type] = (by_type[n.action_type] || 0) + 1;

  return json({ notifications, counts: { total: notifications.length, by_type } });
}
