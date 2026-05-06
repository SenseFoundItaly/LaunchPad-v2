import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';

/**
 * GET /api/dashboard/{projectId}
 *
 * Aggregates the "one-screen-for-the-founder" dashboard:
 *   - metrics + burn + runway          (operational)
 *   - alerts                            (operational alerts)
 *   - monitors                          (ecosystem + health scan status)
 *   - top_ecosystem_alerts              (NEW — high-relevance signals)
 *   - pending_decisions                 (NEW — inbox preview)
 *   - budget                            (NEW — LLM spend meter for current month)
 *
 * Keeps the old top-level shape (metrics/burn_rate/alerts/monitors) so
 * existing callers don't break, adds new fields under the same payload.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const metrics = await query<{ id: string; name: string; type: string; target_growth_rate: number }>(
    'SELECT * FROM metrics WHERE project_id = ?', projectId,
  );
  const metricsWithEntries = [];
  for (const m of metrics) {
    const entries = await query<{ date: string; value: number; notes: string }>(
      'SELECT date, value, notes FROM metric_entries WHERE metric_id = ? ORDER BY date DESC LIMIT 12',
      m.id,
    );
    metricsWithEntries.push({ ...m, entries: entries.reverse() });
  }

  const burnRate = await query<{ monthly_burn: number; cash_on_hand: number; updated_at: string }>(
    'SELECT * FROM burn_rate WHERE project_id = ?', projectId,
  );

  const alerts = await query(
    'SELECT * FROM alerts WHERE project_id = ? AND dismissed = false ORDER BY created_at DESC LIMIT 20',
    projectId,
  );

  const monitors = await query(
    'SELECT * FROM monitors WHERE project_id = ? ORDER BY created_at DESC',
    projectId,
  );

  // --- New sections: ecosystem + pending + budget ---

  // Top ecosystem alerts (last 14 days, relevance >= 0.6, not dismissed).
  // The dashboard preview shows the top 5; the Brief has the full list.
  const topEcosystemAlerts = await query(
    `SELECT id, alert_type, headline, body, source_url, relevance_score, confidence, reviewed_state, created_at
     FROM ecosystem_alerts
     WHERE project_id = ?
       AND created_at >= ?
       AND relevance_score >= 0.6
       AND reviewed_state != 'dismissed'
     ORDER BY relevance_score DESC, created_at DESC
     LIMIT 5`,
    projectId,
    new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
  );

  // Pending decisions (top 5 pending or edited, ranked by created_at desc).
  // Full list lives in /actions inbox.
  const pendingDecisions = await query(
    `SELECT id, action_type, title, rationale, estimated_impact, status, created_at
     FROM pending_actions
     WHERE project_id = ? AND status IN ('pending', 'edited')
     ORDER BY
       CASE estimated_impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
       created_at DESC
     LIMIT 5`,
    projectId,
  );

  // Pending summary counts for a quick glance
  const pendingSummaryRow = (await query<{ pending: number; edited: number; approved: number; sent_7d: number }>(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN status = 'edited' THEN 1 ELSE 0 END) as edited,
       SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
       SUM(CASE WHEN status = 'sent' AND updated_at >= ? THEN 1 ELSE 0 END) as sent_7d
     FROM pending_actions WHERE project_id = ?`,
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    projectId,
  ))[0];

  // Current month budget + month-to-date spend
  const periodMonth = new Date().toISOString().slice(0, 7);
  const budget = (await query<{
    current_llm_usd: number;
    warn_llm_usd: number;
    cap_llm_usd: number;
    status: string;
  }>(
    `SELECT current_llm_usd, warn_llm_usd, cap_llm_usd, status
     FROM project_budgets
     WHERE project_id = ? AND period_month = ?`,
    projectId, periodMonth,
  ))[0];

  return json({
    metrics: metricsWithEntries,
    burn_rate: burnRate.length > 0 ? burnRate[0] : null,
    alerts,
    monitors,
    // New ecosystem + inbox + budget data
    top_ecosystem_alerts: topEcosystemAlerts,
    pending_decisions: pendingDecisions,
    pending_summary: pendingSummaryRow || { pending: 0, edited: 0, approved: 0, sent_7d: 0 },
    budget: budget || {
      current_llm_usd: 0,
      warn_llm_usd: 4.00,
      cap_llm_usd: 5.00,
      status: 'active',
    },
    period_month: periodMonth,
  });
}
