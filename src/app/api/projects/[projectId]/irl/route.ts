import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import { evaluateAllStages } from '@/lib/journey';
import { computeIRL, type IrlEvidence } from '@/lib/irl/ladder';
import type { StageId } from '@/lib/journey/types';

// The Loop-1 interview floor, inlined so the ladder stays decoupled from the
// loop modules — IRL reads EVIDENCE directly (raw WTP / LTV-CAC), it doesn't
// depend on a loop having run. The passing BARS live in ladder.ts.
const IRL_MIN_INTERVIEWS = 5;

/**
 * GET /api/projects/{projectId}/irl
 *
 * The Investment Readiness Level as a 1-9 evidence-gated ladder (see
 * src/lib/irl/ladder.ts). Builds the project snapshot ONCE, derives the flat
 * evidence, and returns the computed level. Read-only: the ladder writes
 * nothing and is recomputed every call (no stored high-water-mark).
 *
 * Levels 5-9 depend on metric feeds (Loops 3-4) and add-on modules that aren't
 * built yet, so their gates can't pass and the ladder caps where the built
 * evidence ends — forward-compatible (higher levels light up as deps ship).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const snapshot = await buildProjectSnapshot(projectId);
  const evals = evaluateAllStages(snapshot);

  const scoreRow = await get<{ overall_score: number | null }>(
    'SELECT overall_score FROM scores WHERE project_id = ?',
    projectId,
  );

  // Loop-1 WTP signal: only meaningful once enough interviews exist; else null
  // (not "0%"). Willingness-to-pay rate = share of interviews with a positive
  // wtp_amount — the same evidence the PSF loop reads.
  const ivs = snapshot.interviews;
  const wtpRate =
    ivs.length >= IRL_MIN_INTERVIEWS
      ? ivs.filter((i) => typeof i.wtp_amount === 'number' && i.wtp_amount > 0).length / ivs.length
      : null;

  // Loop-2 signal: LTV/CAC from the pricing state's unit economics; null when
  // absent or CAC is zero (no divide-by-zero).
  const ue = snapshot.pricing_state?.unit_econ;
  const ltvCacRatio =
    ue?.ltv != null && ue?.cac != null && ue.cac > 0 ? ue.ltv / ue.cac : null;

  const stageDone = (id: StageId) => evals.find((e) => e.stage.id === id)?.status === 'done';
  const trackDone = (track: '1A' | '1B' | '1C') => {
    const gate = evals.find((e) => e.stage.id === 'market_validation');
    if (!gate) return false;
    const inTrack = gate.results.filter((r) => r.check.track === track);
    return inTrack.length > 0 && inTrack.every((r) => r.result.passed);
  };

  const evidence: IrlEvidence = {
    stageDone,
    trackDone,
    hasScore: typeof scoreRow?.overall_score === 'number' && scoreRow.overall_score > 0,
    wtpRate,
    ltvCacRatio,
    // Not yet fed from real sources — the ladder caps here until the Launch
    // Pipeline / Build Hub metric feeds land (Loops 3-4).
    conversionRate: null,
    activationRate: null,
    addOns: new Set<string>(),
  };

  const irl = computeIRL(evidence);
  const active = evals.find((e) => e.status === 'active');

  return json({
    level: irl.level,
    of: irl.of,
    next_key: irl.nextKey,
    current_stage_id: active?.stage.id ?? null,
    current_stage_label: active?.stage.label ?? null,
  });
}
