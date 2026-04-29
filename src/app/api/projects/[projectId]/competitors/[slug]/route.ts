import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import type { CompetitorProfile, EcosystemAlert, IntelligenceBrief } from '@/types';

/**
 * GET /api/projects/{projectId}/competitors/{slug}
 *
 * Single competitor profile + related signals and briefs.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; slug: string }> },
) {
  const { projectId, slug } = await params;

  const profiles = await query<CompetitorProfile>(
    `SELECT id, project_id, name, slug, description, signal_counts,
            total_signals, latest_brief_id, trend_direction,
            last_activity_at, metadata, created_at, updated_at
     FROM competitor_profiles
     WHERE project_id = ? AND slug = ?`,
    projectId,
    slug,
  );

  if (profiles.length === 0) {
    return error('Competitor profile not found', 404);
  }

  const profile = {
    ...profiles[0],
    signal_counts: typeof profiles[0].signal_counts === 'string'
      ? JSON.parse(profiles[0].signal_counts)
      : profiles[0].signal_counts,
    metadata: typeof profiles[0].metadata === 'string'
      ? JSON.parse(profiles[0].metadata)
      : profiles[0].metadata,
  };

  // Fetch related signals (alerts mentioning this competitor)
  const nameLike = `%${profile.name}%`;
  const relatedSignals = await query<EcosystemAlert>(
    `SELECT id, project_id, monitor_id, monitor_run_id, alert_type,
            source, source_url, headline, body, relevance_score, confidence,
            graph_node_id, reviewed_state, reviewed_at, founder_action_taken,
            dedupe_hash, created_at
     FROM ecosystem_alerts
     WHERE project_id = ? AND headline ILIKE ?
     ORDER BY created_at DESC
     LIMIT 20`,
    projectId,
    nameLike,
  );

  // Fetch related briefs
  const relatedBriefs = await query<IntelligenceBrief>(
    `SELECT id, project_id, brief_type, entity_name, title, narrative,
            temporal_prediction, confidence, signal_ids, signal_count,
            recommended_actions, valid_until, status, created_at
     FROM intelligence_briefs
     WHERE project_id = ? AND entity_name = ?
     ORDER BY created_at DESC
     LIMIT 10`,
    projectId,
    profile.name,
  );

  const parsedBriefs = relatedBriefs.map(b => ({
    ...b,
    signal_ids: typeof b.signal_ids === 'string' ? JSON.parse(b.signal_ids) : b.signal_ids,
    recommended_actions: typeof b.recommended_actions === 'string' ? JSON.parse(b.recommended_actions) : b.recommended_actions,
  }));

  return json({
    success: true,
    data: {
      profile,
      signals: relatedSignals,
      briefs: parsedBriefs,
    },
  });
}
