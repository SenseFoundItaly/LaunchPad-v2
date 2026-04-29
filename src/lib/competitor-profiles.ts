/**
 * Competitor Profiles — per-competitor intelligence dossiers.
 *
 * Zero additional LLM cost — purely derived from existing signal data.
 * Called when:
 *   - New ecosystem_alert is persisted (wired into persistEcosystemAlerts)
 *   - New intelligence_brief is created (wired into correlator)
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import type { TrendDirection } from '@/types';

/**
 * Upsert a competitor profile when a new signal references an entity.
 */
export async function updateCompetitorProfile(
  projectId: string,
  entityName: string,
  alertType: string,
): Promise<void> {
  const slug = slugify(entityName);
  if (!slug) return;

  const now = new Date().toISOString();

  // Check if profile exists
  const existing = await query<{ id: string; signal_counts: string; total_signals: number }>(
    `SELECT id, signal_counts, total_signals FROM competitor_profiles
     WHERE project_id = ? AND slug = ?`,
    projectId,
    slug,
  );

  if (existing.length > 0) {
    const profile = existing[0];
    const counts: Record<string, number> = typeof profile.signal_counts === 'string'
      ? JSON.parse(profile.signal_counts)
      : (profile.signal_counts as Record<string, number>) || {};
    counts[alertType] = (counts[alertType] || 0) + 1;
    const totalSignals = Object.values(counts).reduce((sum, n) => sum + n, 0);

    // Derive trend direction from signal velocity
    const trendDirection = await deriveTrendDirection(projectId, slug, entityName);

    await run(
      `UPDATE competitor_profiles
       SET signal_counts = ?, total_signals = ?, last_activity_at = ?,
           trend_direction = ?, updated_at = ?
       WHERE id = ?`,
      JSON.stringify(counts),
      totalSignals,
      now,
      trendDirection,
      now,
      profile.id,
    );
  } else {
    const id = generateId('cp');
    const counts: Record<string, number> = { [alertType]: 1 };
    await run(
      `INSERT INTO competitor_profiles
         (id, project_id, name, slug, signal_counts, total_signals,
          trend_direction, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'stable', ?, ?, ?)`,
      id,
      projectId,
      entityName,
      slug,
      JSON.stringify(counts),
      now,
      now,
      now,
    );
  }
}

/**
 * Link a brief to its competitor profile when entity_name matches.
 */
export async function linkBriefToProfile(
  projectId: string,
  entityName: string,
  briefId: string,
): Promise<void> {
  const slug = slugify(entityName);
  if (!slug) return;

  await run(
    `UPDATE competitor_profiles SET latest_brief_id = ?, updated_at = ?
     WHERE project_id = ? AND slug = ?`,
    briefId,
    new Date().toISOString(),
    projectId,
    slug,
  );
}

/**
 * Derive trend direction from signal velocity.
 * Compares signals in last 7d vs previous 7d.
 */
async function deriveTrendDirection(
  projectId: string,
  _slug: string,
  entityName: string,
): Promise<TrendDirection> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const nameLike = `%${entityName}%`;

  const recentCount = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM ecosystem_alerts
     WHERE project_id = ? AND headline ILIKE ? AND created_at >= ?`,
    projectId,
    nameLike,
    sevenDaysAgo,
  );

  const priorCount = await query<{ cnt: string }>(
    `SELECT COUNT(*) as cnt FROM ecosystem_alerts
     WHERE project_id = ? AND headline ILIKE ?
       AND created_at >= ? AND created_at < ?`,
    projectId,
    nameLike,
    fourteenDaysAgo,
    sevenDaysAgo,
  );

  const recent = parseInt(recentCount[0]?.cnt || '0', 10);
  const prior = parseInt(priorCount[0]?.cnt || '0', 10);

  if (recent > prior * 1.5) return 'expanding';
  if (recent < prior * 0.5 && prior > 0) return 'contracting';
  // Check for type diversity as a pivot signal
  if (recent > 0) {
    const types = await query<{ alert_type: string }>(
      `SELECT DISTINCT alert_type FROM ecosystem_alerts
       WHERE project_id = ? AND headline ILIKE ? AND created_at >= ?`,
      projectId,
      nameLike,
      sevenDaysAgo,
    );
    if (types.length >= 3) return 'pivoting';
  }
  return 'stable';
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}
