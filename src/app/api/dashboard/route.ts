import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { STAGES } from '@/lib/stages';

/** Cross-project dashboard data for the homepage command center */
export async function GET() {
  let orgId: string;
  try {
    ({ orgId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return json({ error: e.message }, e.status);
    throw e;
  }

  // Projects the user has access to (via org membership).
  const projects = await query<{
    id: string; name: string; description: string; status: string;
    current_step: number; created_at: string;
  }>('SELECT * FROM projects WHERE org_id = ? ORDER BY created_at DESC', orgId);

  // Per-project skill counts
  const skillCounts = await query<{ project_id: string; count: number }>(
    `SELECT project_id, COUNT(*) as count FROM skill_completions
     WHERE status = 'completed' GROUP BY project_id`
  );
  const skillMap: Record<string, number> = {};
  for (const s of skillCounts) skillMap[s.project_id] = s.count;

  // Recent ecosystem signals across all projects (last 20)
  const alerts = await query<{
    id: string; project_id: string; alert_type: string; headline: string;
    body: string; source_url: string | null; relevance_score: number;
    confidence: number; created_at: string;
  }>(
    `SELECT id, project_id, alert_type, headline, body, source_url,
            relevance_score, confidence, created_at
     FROM ecosystem_alerts
     WHERE reviewed_state != 'dismissed'
     ORDER BY created_at DESC LIMIT 20`
  );

  // Weekly signal counts per project
  const weeklyAlerts = await query<{ project_id: string; count: number }>(
    `SELECT project_id, COUNT(*) as count FROM ecosystem_alerts
     WHERE created_at > NOW() - INTERVAL '7 days' AND reviewed_state != 'dismissed'
     GROUP BY project_id`
  );
  const weeklyMap: Record<string, number> = {};
  for (const w of weeklyAlerts) weeklyMap[w.project_id] = w.count;

  // Enrich projects
  const enriched = projects.map(p => ({
    project_id: p.id,
    name: p.name,
    description: p.description,
    status: p.status,
    analyses_completed: skillMap[p.id] || 0,
    total_analyses: STAGES.reduce((sum, s) => sum + s.skills.length, 0),
    weekly_alerts: weeklyMap[p.id] || 0,
    created_at: p.created_at,
  }));

  // Project name lookup for alerts
  const projectNames: Record<string, string> = {};
  for (const p of projects) projectNames[p.id] = p.name;

  const ALERT_TYPE_LABELS: Record<string, string> = {
    competitor_activity: 'Competitor',
    trend_signal: 'Trend',
    market_shift: 'Market',
    regulatory_change: 'Regulatory',
    funding_event: 'Funding',
    partnership: 'Partnership',
    product_launch: 'Launch',
    talent_move: 'Talent',
  };

  const enrichedAlerts = alerts.map(a => ({
    id: a.id,
    project_id: a.project_id,
    project_name: projectNames[a.project_id] || '',
    alert_type: a.alert_type,
    alert_type_label: ALERT_TYPE_LABELS[a.alert_type] || a.alert_type.replace(/_/g, ' '),
    headline: a.headline,
    body: a.body,
    severity: a.relevance_score >= 0.8 ? 'high' : a.relevance_score >= 0.5 ? 'medium' : 'low',
    relevance_score: a.relevance_score,
    source_url: a.source_url,
    created_at: a.created_at,
  }));

  return json({
    projects: enriched,
    signals: enrichedAlerts,
    stats: {
      total_projects: projects.length,
      total_analyses_completed: Object.values(skillMap).reduce((a, b) => a + b, 0),
      total_alerts_this_week: Object.values(weeklyMap).reduce((a, b) => a + b, 0),
    },
  });
}
