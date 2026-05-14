import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

/**
 * GET /api/projects/{projectId}/signal-logs
 *
 * Paginated activity log for the signal pipeline. Feeds the Log tab in
 * the Signals page. Supports optional event_type filter and time window.
 *
 * Query params:
 *   event_type? — filter by a specific event type
 *   days        — lookback window (default 30)
 *   limit       — max rows (default 50, max 200)
 *   offset      — pagination offset (default 0)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const sp = request.nextUrl.searchParams;

  const eventType = sp.get('event_type') || null;
  const days = Math.max(1, Math.min(365, Number(sp.get('days')) || 30));
  const limit = Math.max(1, Math.min(200, Number(sp.get('limit')) || 50));
  const offset = Math.max(0, Number(sp.get('offset')) || 0);

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const conditions = ['project_id = ?', 'created_at >= ?'];
  const args: unknown[] = [projectId, since];

  if (eventType) {
    conditions.push('event_type = ?');
    args.push(eventType);
  }

  const whereClause = conditions.join(' AND ');

  const totalRow = await get<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM signal_activity_logs WHERE ${whereClause}`,
    ...args,
  );

  const logs = await query<Record<string, unknown>>(
    `SELECT id, event_type, entity_id, entity_type, headline, metadata, created_at
     FROM signal_activity_logs
     WHERE ${whereClause}
     ORDER BY created_at DESC
     LIMIT ${limit} OFFSET ${offset}`,
    ...args,
  );

  // Aggregate LLM cost per step for monitor/cron activity in the same time window.
  // The `step` column in llm_usage_logs contains values like 'cron.ecosystem.competitors',
  // 'cron.heartbeat', etc. — grouping by step gives per-monitor cost attribution.
  const costByStep = await query<{ step: string; total_cost_usd: number; call_count: number }>(
    `SELECT step, SUM(total_cost_usd) AS total_cost_usd, COUNT(*) AS call_count
     FROM llm_usage_logs
     WHERE project_id = ? AND created_at >= ? AND step IS NOT NULL AND step LIKE 'cron.%'
     GROUP BY step
     ORDER BY total_cost_usd DESC`,
    projectId, since,
  ).catch((err) => {
    console.warn('[signal-logs] cost aggregation failed:', (err as Error).message);
    return [];
  });

  return json({
    logs,
    total: totalRow?.count ?? 0,
    limit,
    offset,
    cost_by_step: costByStep,
  });
}
