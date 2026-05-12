import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import type { CompetitorProfile } from '@/types';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

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
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const profiles = await query<CompetitorProfile>(
    `SELECT id, project_id, name, slug, description, signal_counts,
            total_signals, latest_brief_id, trend_direction,
            last_activity_at, metadata, created_at, updated_at
     FROM competitor_profiles
     WHERE project_id = ?
     ORDER BY total_signals DESC`,
    projectId,
  );

  const parsed = profiles.map(p => {
    let signal_counts = p.signal_counts;
    let metadata = p.metadata;
    try { if (typeof signal_counts === 'string') signal_counts = JSON.parse(signal_counts); } catch { signal_counts = {}; }
    try { if (typeof metadata === 'string') metadata = JSON.parse(metadata); } catch { metadata = {}; }
    return { ...p, signal_counts, metadata };
  });

  return json({ success: true, data: parsed });
}
