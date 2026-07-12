import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { recordLoop1Verdict, overrideLoop1, LoopNotFoundError } from '@/lib/loops/loop1-psf';

/**
 * POST /api/projects/{projectId}/loops/{loopId}
 *   { action: 'verdict',  verdict: 'GO'|'PIVOT'|'STOP' }   — record the cap verdict
 *   { action: 'override', motivation: string }             — ignore-with-motivation (§4)
 *
 * The verdict/override verbs are folded onto this dynamic [loopId] leaf (not a
 * static sub-route) — the OpenNext adapter 404s a static leaf under two dynamic
 * segments (finding_opennext_static_leaf_two_dynamic_404).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; loopId: string }> },
) {
  const { projectId, loopId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string; verdict?: string; motivation?: string;
  };

  if (body.action === 'verdict') {
    const v = body.verdict;
    if (v !== 'GO' && v !== 'PIVOT' && v !== 'STOP') return error('verdict must be GO, PIVOT or STOP', 400);
    // recordLoop1Verdict is idempotent — on a re-submit (reloaded card) it
    // returns the verdict ALREADY on record, so we echo the effective verdict.
    try {
      const recorded = await recordLoop1Verdict(projectId, loopId, auth.session.userId, v);
      return json({ loop_id: loopId, verdict: recorded });
    } catch (err) {
      if (err instanceof LoopNotFoundError) return error('loop not found', 404);
      throw err;
    }
  }

  if (body.action === 'override') {
    const motivation = (body.motivation ?? '').trim();
    if (motivation.length < 3) return error('an override needs a short motivation', 400);
    await overrideLoop1(projectId, loopId, auth.session.userId, motivation);
    return json({ loop_id: loopId, overridden: true });
  }

  return error('action must be "verdict" or "override"', 400);
}
