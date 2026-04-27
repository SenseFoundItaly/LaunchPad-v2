import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get } from '@/lib/db';
import { getCreditsSnapshot } from '@/lib/credits';

/**
 * GET /api/projects/{projectId}/credits
 *
 * Cheap snapshot endpoint for the TopBar credits badge. Safe to poll on a
 * 30s interval. Returns the same shape as `getCreditsSnapshot()` so the
 * client can show "remaining" + the soft "used_today / daily_cap" anchor.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const project = await get<{ id: string }>('SELECT id FROM projects WHERE id = ?', projectId);
  if (!project) return error('Project not found', 404);
  return json(await getCreditsSnapshot(projectId));
}
