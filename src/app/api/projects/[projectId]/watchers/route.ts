import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import { get } from '@/lib/db';
import { listWatchers } from '@/lib/watchers';

/**
 * GET /api/projects/{projectId}/watchers
 *
 * Returns the unified list of watchers across the underlying `monitors` table
 * (LLM-scan flavor) and `watch_sources` table (URL-diff flavor). The founder
 * thinks in one primitive — a watcher — and the UI shouldn't care which
 * mechanism produced each row.
 *
 * This is the iter-3.5 founder-facing read endpoint. The legacy /monitors
 * route still exists for backward compatibility (monitor detail page,
 * existing scripts) but new UI consumers should use /watchers.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId } = await params;
  // Owner / membership check — same shape as /monitors uses
  const proj = await get<{ owner_user_id: string | null }>(
    `SELECT p.owner_user_id FROM projects p
       LEFT JOIN memberships m ON m.org_id = p.org_id AND m.user_id = ?
       WHERE p.id = ? AND (p.owner_user_id = ? OR m.user_id IS NOT NULL)`,
    userId, projectId, userId,
  );
  if (!proj) return error('Project not found or not accessible', 404);

  const watchers = await listWatchers(projectId);
  return json(watchers);
}
