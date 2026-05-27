import { NextRequest } from 'next/server';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { processCorrelations } from '@/lib/intelligence-correlator';

/**
 * POST /api/projects/{projectId}/intelligence/run
 *
 * On-demand correlator trigger — bypasses the weekly cadence + 7-day "recent
 * brief exists" guard so a founder asking "what do you see right now?" gets
 * an answer without waiting for the cron tick.
 *
 * The signal-floor (now <2) and the ICP-tie validator still apply, so a
 * project with no signals (or no founder moat in the context) just returns
 * { briefs_created: 0, skipped_reason: ... } — the caller can render that.
 *
 * Idempotent enough: running twice in a row will mark the just-created brief
 * as 'superseded' and produce a fresh one. Worth showing a "thinking…" state
 * in the UI to discourage spam.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const result = await processCorrelations(projectId, { force: true });
  return json(result);
}
