import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { typesForLane } from '@/lib/pending-actions';

/**
 * GET /api/projects/{projectId}/approvals
 *
 * Returns open approval-lane pending_actions — things the agent DRAFTED that
 * the founder needs to Approve / Edit / Reject (monitor configs, budget caps,
 * workflow steps, draft emails/posts/DMs, proposed hypotheses / interview
 * questions / landing copy / investor followups / graph updates).
 *
 * Phase 1 of the 4-bucket reorganization (buckets-tasks-intelligence-signals-
 * assets.md). Powers the "Approvals" tab in /project/[projectId]/actions.
 *
 * Query: ?status=pending,edited (default: pending+edited — i.e. open).
 */

interface ActionRow {
  id: string;
  project_id: string;
  title: string;
  rationale: string | null;
  payload: string | null;
  action_type: string;
  status: string;
  sources: string | null;
  estimated_impact: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_STATUSES = new Set(['pending', 'edited', 'approved', 'sent', 'rejected', 'failed']);

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
    return json({ approvals: [], counts: { total: 0, by_type: {} } });
  }

  const approvalTypes = typesForLane('approval');
  const statusPlaceholders = statuses.map(() => '?').join(',');
  const typePlaceholders = approvalTypes.map(() => '?').join(',');

  const rows = await query<ActionRow>(
    `SELECT id, project_id, title, rationale, payload, action_type, status, sources,
            estimated_impact, created_at, updated_at
     FROM pending_actions
     WHERE project_id = ?
       AND action_type IN (${typePlaceholders})
       AND status IN (${statusPlaceholders})
     ORDER BY
       CASE estimated_impact
         WHEN 'high'   THEN 1
         WHEN 'medium' THEN 2
         WHEN 'low'    THEN 3
         ELSE 4
       END,
       created_at DESC
     LIMIT 200`,
    projectId,
    ...approvalTypes,
    ...statuses,
  );

  const approvals = rows.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    title: r.title,
    rationale: r.rationale,
    action_type: r.action_type,
    estimated_impact: r.estimated_impact,
    status: r.status,
    payload: r.payload || {},
    sources: r.sources || [],
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  const by_type: Record<string, number> = {};
  for (const a of approvals) by_type[a.action_type] = (by_type[a.action_type] || 0) + 1;

  return json({ approvals, counts: { total: approvals.length, by_type } });
}
