import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

interface UsageRow {
  id: string;
  project_id: string;
  skill_id: string | null;
  step: string | null;
  provider: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
  latency_ms: number;
  created_at: string;
}

interface SkillCost {
  skill_id: string;
  total_cost: number;
  call_count: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  if (!projectId) return error('projectId is required');

  // Recent logs (last 100)
  const logs = await query<UsageRow>(
    `SELECT * FROM llm_usage_logs
     WHERE project_id = ?
     ORDER BY created_at DESC
     LIMIT 100`,
    projectId,
  );

  // Aggregations
  const totals = await query<{
    total_cost: number;
    total_input: number;
    total_output: number;
    total_cache_creation: number;
    total_cache_read: number;
    call_count: number;
  }>(
    `SELECT
       COALESCE(SUM(total_cost_usd), 0) AS total_cost,
       COALESCE(SUM(input_tokens), 0) AS total_input,
       COALESCE(SUM(output_tokens), 0) AS total_output,
       COALESCE(SUM(cache_creation_tokens), 0) AS total_cache_creation,
       COALESCE(SUM(cache_read_tokens), 0) AS total_cache_read,
       COUNT(*) AS call_count
     FROM llm_usage_logs
     WHERE project_id = ?`,
    projectId,
  );

  // Per-skill breakdown
  const bySkill = await query<SkillCost>(
    `SELECT
       COALESCE(skill_id, step, 'unknown') AS skill_id,
       COALESCE(SUM(total_cost_usd), 0) AS total_cost,
       COUNT(*) AS call_count
     FROM llm_usage_logs
     WHERE project_id = ?
     GROUP BY COALESCE(skill_id, step, 'unknown')
     ORDER BY total_cost DESC`,
    projectId,
  );

  const summary = totals[0] || {
    total_cost: 0,
    total_input: 0,
    total_output: 0,
    total_cache_creation: 0,
    total_cache_read: 0,
    call_count: 0,
  };

  return json({
    summary: {
      total_cost_usd: summary.total_cost,
      total_tokens: summary.total_input + summary.total_output,
      total_input_tokens: summary.total_input,
      total_output_tokens: summary.total_output,
      total_cache_creation_tokens: summary.total_cache_creation,
      total_cache_read_tokens: summary.total_cache_read,
      call_count: summary.call_count,
    },
    by_skill: bySkill,
    logs,
  });
}
