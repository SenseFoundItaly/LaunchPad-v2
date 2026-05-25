import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { loadMonitorContext } from '@/lib/ecosystem-monitors';
import { listWatchers } from '@/lib/watchers';
import { proposeWatchers } from '@/lib/watcher-proposer';

/**
 * POST /api/projects/[projectId]/watchers/suggest
 *
 * Returns 3-5 proposed watchers tailored to this project's idea, competitors,
 * and keywords. Caller renders them in a drawer; founder accepts a subset
 * via /accept. Nothing is persisted here — pure proposal step.
 *
 * Body: ignored. The proposer derives context from the project itself.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let ctx;
  try {
    ctx = await loadMonitorContext(projectId);
  } catch (err) {
    return error(`Failed to load project context: ${(err as Error).message}`, 500);
  }

  // Existing watchers — feeds the dedup rule in the prompt.
  const existing = await listWatchers(projectId);
  const existingNames = existing.map((w) => w.name);

  const result = await proposeWatchers({
    projectId,
    projectName: ctx.projectName,
    idea: ctx.idea || null,
    knownCompetitors: ctx.knownCompetitors,
    keywords: ctx.keywords,
    existingWatcherNames: existingNames,
    locale: ctx.locale,
  });

  return json({
    proposed: result.proposed,
    skipped_reason: result.skipped_reason || null,
  });
}
