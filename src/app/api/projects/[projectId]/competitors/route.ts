import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import type { CompetitorProfile } from '@/types';

/**
 * GET /api/projects/{projectId}/competitors
 *
 * List all competitor profiles for a project, sorted by total_signals desc.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const profiles = await query<CompetitorProfile>(
    `SELECT id, project_id, name, slug, description, signal_counts,
            total_signals, latest_brief_id, trend_direction,
            last_activity_at, metadata, created_at, updated_at
     FROM competitor_profiles
     WHERE project_id = ?
     ORDER BY total_signals DESC`,
    projectId,
  );

  const parsed = profiles.map(p => ({
    ...p,
    signal_counts: typeof p.signal_counts === 'string' ? JSON.parse(p.signal_counts) : p.signal_counts,
    metadata: typeof p.metadata === 'string' ? JSON.parse(p.metadata) : p.metadata,
  }));

  return json({ success: true, data: parsed });
}
