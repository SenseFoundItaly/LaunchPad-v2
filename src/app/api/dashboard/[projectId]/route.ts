import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';

/** Per-project dashboard: metrics, burn rate, alerts, monitors */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  // Metrics with entries
  const metrics = query<{
    id: string; name: string; type: string; target_growth_rate: number;
  }>('SELECT * FROM metrics WHERE project_id = ?', projectId);

  const metricsWithEntries = metrics.map(m => {
    const entries = query<{ date: string; value: number; notes: string }>(
      'SELECT date, value, notes FROM metric_entries WHERE metric_id = ? ORDER BY date DESC LIMIT 12',
      m.id,
    );
    return { ...m, entries: entries.reverse() };
  });

  // Burn rate
  const burnRate = query<{ monthly_burn: number; cash_on_hand: number; updated_at: string }>(
    'SELECT * FROM burn_rate WHERE project_id = ?', projectId,
  );

  // Alerts (non-dismissed)
  const alerts = query(
    'SELECT * FROM alerts WHERE project_id = ? AND dismissed = 0 ORDER BY created_at DESC LIMIT 20',
    projectId,
  );

  // Monitors
  const monitors = query(
    'SELECT * FROM monitors WHERE project_id = ? ORDER BY created_at DESC',
    projectId,
  );

  return json({
    metrics: metricsWithEntries,
    burn_rate: burnRate.length > 0 ? burnRate[0] : null,
    alerts,
    monitors,
  });
}
