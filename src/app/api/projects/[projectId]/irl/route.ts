import { NextRequest } from 'next/server';
import { get } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import { evaluateAllStages } from '@/lib/journey';
import { computeIRL, IRL_MAX, IRL_CORE_MAX, type IrlEvidence } from '@/lib/irl/ladder';
import { readIrlFloor, raiseIrlFloor } from '@/lib/irl/floor';
import type { StageId } from '@/lib/journey/types';

// The Loop-1 interview floor, inlined so the ladder stays decoupled from the
// loop modules — IRL reads EVIDENCE directly (raw WTP / LTV-CAC), it doesn't
// depend on a loop having run. The passing BARS live in ladder.ts.
const IRL_MIN_INTERVIEWS = 5;

/**
 * Which upstream metric feeds actually exist today (#338). The ladder declares
 * all nine rungs, but levels 5-9 read evidence nothing currently produces, so
 * showing a bare "/ 9" promises a climb the product cannot deliver.
 *
 * `reachable_max` is derived from these flags and rendered by the UI, so the
 * founder is never shown a denominator they cannot reach. Flip a flag when its
 * feed lands and the ceiling moves on its own — no UI change.
 */
const CONVERSION_FEED_LIVE = false; // Loop 3 / landing conversion — PR #225
const ACTIVATION_FEED_LIVE = false; // Loop 4 / MVP activation   — PR #218
const ADDON_MODULES_LIVE = false;   // IRL 7-9 paid modules      — #298/#299/#300

function reachableMax(): number {
  if (!CONVERSION_FEED_LIVE) return 4;            // level 5's gate can never pass
  if (!ACTIVATION_FEED_LIVE) return 5;
  return ADDON_MODULES_LIVE ? IRL_MAX : IRL_CORE_MAX;
}

/**
 * GET /api/projects/{projectId}/irl
 *
 * The Investment Readiness Level as a 1-9 evidence-gated ladder (see
 * src/lib/irl/ladder.ts). Builds the project snapshot ONCE, derives the flat
 * evidence, and returns the level.
 *
 * The ladder itself is pure and recomputed every call, but the RESULT is
 * floored by a stored high-water mark (#296) — IRL is a milestone, not a live
 * gauge. `earned` is what today's evidence supports; `level` is what the
 * founder sees; `regressed` says the two disagree. Only a PIVOT clears the
 * floor (src/lib/irl/floor.ts).
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
    // 0 counts as unscored (legacy rows fabricated a literal 0 baseline); the
    // level-2 gate applies the Caution/Go bar to the value itself.
    score: typeof scoreRow?.overall_score === 'number' && scoreRow.overall_score > 0
      ? scoreRow.overall_score
      : null,
    wtpRate,
    ltvCacRatio,
    // Not yet fed from real sources — the ladder caps here until the Launch
    // Pipeline / Build Hub metric feeds land (Loops 3-4).
    conversionRate: null,
    activationRate: null,
    addOns: new Set<string>(),
  };

  // High-water floor (#296): IRL is a milestone, not a live gauge, so a dip in
  // one signal must not un-earn a level. Only a PIVOT clears the floor — see
  // src/lib/irl/floor.ts.
  const floor = await readIrlFloor(projectId);
  const irl = computeIRL(evidence, floor);

  // Persist upward on read. A GET that writes is unusual, but this is a
  // monotonic GREATEST update (idempotent, concurrency-safe) and the
  // alternative is duplicating the raise into every writer that could move the
  // ladder — the "one write path" rule the gate checks already taught us.
  if (irl.earned > (floor.level ?? 0)) {
    await raiseIrlFloor(projectId, irl.earned);
  }

  const active = evals.find((e) => e.status === 'active');

  return json({
    level: irl.level,
    of: irl.of,
    next_key: irl.nextKey,
    reachable_max: reachableMax(),
    earned: irl.earned,
    regressed: irl.regressed,
    current_stage_id: active?.stage.id ?? null,
    current_stage_label: active?.stage.label ?? null,
  });
}
