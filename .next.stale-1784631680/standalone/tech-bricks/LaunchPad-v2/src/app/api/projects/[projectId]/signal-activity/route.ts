import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { query } from '@/lib/db';

/**
 * GET /api/projects/{projectId}/signal-activity
 *
 * Recent rows from signal_activity_logs — the fire-and-forget audit trail the
 * signal pipeline writes via logSignalActivity() (monitor_ran, monitor_failed,
 * signal_created, watch_source_scraped, …). Powers the "Watcher runs" log
 * under the Inbox Signals tab. Newest 15, no pagination: the founder wants a
 * glanceable "did my watchers actually run" answer, not an archive browser.
 */

interface SignalActivityLogRow {
  id: string;
  event_type: string;
  headline: string;
  entity_type: string | null;
  created_at: string | Date;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  // tryProjectAccess (not a memberships-only check) so shared users — a
  // project_members row under a different org — can read the run log too.
  // Same rationale as the sibling /watchers route.
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query<SignalActivityLogRow>(
    `SELECT id, event_type, headline, entity_type, created_at
       FROM signal_activity_logs
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 15`,
    projectId,
  );

  // postgres.js returns TIMESTAMP columns as JS Date objects. Normalize to
  // ISO strings explicitly so the client's relative-time math sees a stable,
  // parseable shape rather than whatever the serializer happens to emit.
  return json(
    rows.map((r) => ({
      ...r,
      created_at: new Date(r.created_at).toISOString(),
    })),
  );
}
