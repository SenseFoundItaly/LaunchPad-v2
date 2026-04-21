import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

/**
 * GET /api/projects/{projectId}/usage/groups
 *
 * Aggregates llm_usage_logs for the current month by `step`, returning
 * per-category spend for the Dashboard's Budget panel. Uses `step` as the
 * group key because cost-meter.ts sets it to values like
 *   - `cron.ecosystem.competitors`
 *   - `manual.ecosystem.ip`
 *   - `chat` (from the chat telemetry hook)
 * which are the natural budget categories.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const periodMonth = new Date().toISOString().slice(0, 7);

  const rows = query<{
    step: string | null;
    provider: string;
    model: string;
    total_cost_usd: number;
    call_count: number;
  }>(
    `SELECT
       step,
       provider,
       COALESCE(model, 'unknown') AS model,
       SUM(total_cost_usd) AS total_cost_usd,
       COUNT(*) AS call_count
     FROM llm_usage_logs
     WHERE project_id = ?
       AND created_at >= ?
     GROUP BY step, provider, model
     ORDER BY total_cost_usd DESC
     LIMIT 10`,
    projectId,
    `${periodMonth}-01T00:00:00.000Z`,
  );

  // Normalize null step to "unlabeled" for display; consumers treat null as a
  // distinct bucket from "unlabeled" intentionally.
  return json(rows.map(r => ({
    step: r.step || null,
    provider: r.provider,
    model: r.model,
    total_cost_usd: Number(r.total_cost_usd) || 0,
    call_count: Number(r.call_count) || 0,
  })));
}
