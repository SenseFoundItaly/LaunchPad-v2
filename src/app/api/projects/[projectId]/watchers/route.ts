import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
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
  const { projectId } = await params;
  // Use the canonical project-access helper so shared users (project_members
  // row with a different org) can read the unified watchers list. The earlier
  // ad-hoc memberships-only check missed project_members and 404'd for shared
  // users — discovered while debugging "shared project signals error" in QA.
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const watchers = await listWatchers(projectId);
  return json(watchers);
}
