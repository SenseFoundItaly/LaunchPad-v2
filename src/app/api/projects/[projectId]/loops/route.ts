import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { triggerLoop1Manual } from '@/lib/loops/loop1-psf';

/**
 * GET /api/projects/{projectId}/loops
 * List the project's validation loops (newest first) for the loop UI.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const rows = await query(
    `SELECT id, loop_number, iteration, status, trigger, loop_score, scope, verdict,
            verdict_evidence, override_motivation, pending_action_id, created_at, closed_at
       FROM validation_loops WHERE project_id = ? ORDER BY created_at DESC`,
    projectId,
  );
  return json(rows);
}

/**
 * POST /api/projects/{projectId}/loops  { loop_number: 1 }
 * Manual activation (§8: mandatory second path) — the founder opens a PSF review
 * even when the auto-threshold didn't fire. Returns the (new or existing) loop id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { loop_number?: number };
  if ((body.loop_number ?? 1) !== 1) return error('only loop 1 (PSF Review) is supported', 400);
  const loopId = await triggerLoop1Manual(projectId, auth.session.userId);
  return json({ loop_id: loopId });
}
