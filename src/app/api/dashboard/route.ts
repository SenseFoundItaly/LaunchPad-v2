import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { AuthError, requireUser } from '@/lib/auth/require-user';

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
  const projects = query<{
    id: string; name: string; description: string; status: string;
    current_step: number; created_at: string;
  }>('SELECT * FROM projects WHERE org_id = ? ORDER BY created_at DESC', orgId);

  // Per-project skill counts
  const skillCounts = query<{ project_id: string; count: number }>(
    `SELECT project_id, COUNT(*) as count FROM skill_completions
     WHERE status = 'completed' GROUP BY project_id`
  );
  const skillMap: Record<string, number> = {};
  for (const s of skillCounts) skillMap[s.project_id] = s.count;

  // Recent alerts across all projects (last 20)
  const alerts = query<{
    id: string; project_id: string; type: string; severity: string;
    message: string; created_at: string;
  }>(
    `SELECT a.id, a.project_id, a.type, a.severity, a.message, a.created_at
     FROM alerts a WHERE a.dismissed = 0
     ORDER BY a.created_at DESC LIMIT 20`
  );

  // Weekly alert counts per project
  const weeklyAlerts = query<{ project_id: string; count: number }>(
    `SELECT project_id, COUNT(*) as count FROM alerts
     WHERE created_at > datetime('now', '-7 days') AND dismissed = 0
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
    skills_completed: skillMap[p.id] || 0,
    total_skills: 17,
    weekly_alerts: weeklyMap[p.id] || 0,
    created_at: p.created_at,
  }));

  // Project name lookup for alerts
  const projectNames: Record<string, string> = {};
  for (const p of projects) projectNames[p.id] = p.name;

  const enrichedAlerts = alerts.map(a => ({
    ...a,
    project_name: projectNames[a.project_id] || 'Unknown',
  }));

  return json({
    projects: enriched,
    signals: enrichedAlerts,
    stats: {
      total_projects: projects.length,
      total_skills_completed: Object.values(skillMap).reduce((a, b) => a + b, 0),
      total_alerts_this_week: Object.values(weeklyMap).reduce((a, b) => a + b, 0),
    },
  });
}
