/**
 * Phase view — a READ-ONLY reduction of the 7 canonical stages into the founder-
 * facing 5 macro phases (+ the cross-cutting Financial & Pitch module + the 4
 * validation loops in the critical transitions), matching the /demo spine and
 * Luca's architecture table.
 *
 * This is presentation only: it groups the existing `evaluateAllStages()` output
 * and the live `validation_loops` — it does NOT change stage ids, numbers,
 * `current_step`, or the DB. The destructive id/number re-taxonomy (that MERGES
 * gate+persona and SPLITS build/launch at the engine level) is #307, gated on
 * the re-lock decision (#309) + product decisions (#310). Until then, phases 3
 * and 4 both reduce from the single `build_launch` stage (they can't be tracked
 * apart yet — noted where it matters).
 *
 * Grouping choices (following the demo / Luca's table — adjust here if they change):
 *  - Persona folds into the Validation Gate's evidence (buyer_persona already a
 *    1A check); there is no standalone Persona phase.
 *  - Fundraise + Operate leave the linear spine → they're the IRL 7-9 add-ons.
 *
 * Zero runtime deps (no DB / journey imports) — pure, testable.
 */

import type { StageId } from './types';

/** Minimal shape of a StageEvaluation this reduction needs (matches useStages
 *  / evaluateAllStages: stage id + top-level status). */
export interface PhaseEval {
  stage: { id: string };
  status: 'done' | 'active' | 'pending';
  /** Check tallies — summed across a phase's stages for the evidence readout. */
  passed?: number;
  total?: number;
}

export interface PhaseDef {
  /** 0-based macro-phase number shown to the founder. */
  n: number;
  /** Proper name — kept English like Luca's table (chrome localizes, names don't). */
  label: string;
  /** Which canonical stage ids reduce into this phase. */
  stageIds: StageId[];
  /** Loop number that gates the transition OUT of this phase (interleaved after it). */
  loopAfter?: 1 | 2 | 3 | 4;
  /** The cross-cutting Financial & Pitch module opens after this phase. */
  moduleAfter?: boolean;
}

export const PHASES: readonly PhaseDef[] = [
  { n: 0, label: 'Idea Canvas', stageIds: ['idea_validation'] },
  { n: 1, label: 'Validation Gate', stageIds: ['market_validation'], loopAfter: 1 },
  { n: 2, label: 'Business Essentials', stageIds: ['persona', 'business_model'], loopAfter: 2, moduleAfter: true },
  { n: 3, label: 'Build & Test Sandbox', stageIds: ['build_launch'], loopAfter: 3 },
  { n: 4, label: 'MVP Release & Launch', stageIds: ['build_launch'], loopAfter: 4 },
];

export type PhaseStatus = 'done' | 'active' | 'pending';

/** A phase is done when every stage it reduces from is done; active once any of
 *  them has started (active, or partially done); else pending. */
export function phaseStatus(phase: PhaseDef, evals: PhaseEval[]): PhaseStatus {
  const mine = phase.stageIds
    .map((id) => evals.find((e) => e.stage.id === id)?.status)
    .filter((s): s is PhaseStatus => !!s);
  if (mine.length > 0 && mine.every((s) => s === 'done')) return 'done';
  if (mine.some((s) => s === 'active' || s === 'done')) return 'active';
  return 'pending';
}

/**
 * What the spine SHOWS, which is not the same as the raw per-stage status.
 *
 * `evaluateAllStages` marks a stage done independently (passed === total), and
 * the later stages carry far fewer checks than the early ones (persona 2,
 * business_model 5, build_launch 4 vs idea_validation 9, market_validation 12).
 * So later phases routinely go green while phase 0 is still incomplete — on a
 * full 5-row spine that reads as "you finished Business Essentials, Build &
 * Test and MVP Release" to a founder who is still on Idea Canvas. Observed on
 * real projects.
 *
 * So the spine is CONTIGUOUS, exactly like the IRL ladder: a phase only claims
 * "validated" when every earlier phase is validated too. A phase whose own
 * evidence is complete but which is blocked by an earlier gap renders 'ahead'
 * — truthful ("evidence ready") without the false completion claim. Both
 * surfaces then tell the founder one coherent story.
 */
export type PhaseDisplayStatus = 'done' | 'ahead' | 'active' | 'pending';

export type SpineNode =
  | { kind: 'phase'; n: number; label: string; status: PhaseDisplayStatus; passed: number; total: number }
  | { kind: 'module'; label: string }
  | { kind: 'loop'; loopNumber: number };

/** Evidence tally across the stages a phase reduces from. */
export function phaseEvidence(phase: PhaseDef, evals: PhaseEval[]): { passed: number; total: number } {
  let passed = 0, total = 0;
  for (const id of phase.stageIds) {
    const e = evals.find((x) => x.stage.id === id);
    if (!e) continue;
    passed += e.passed ?? 0;
    total += e.total ?? 0;
  }
  return { passed, total };
}

/** The ordered spine: phases with CONTIGUOUS display status + evidence counts,
 *  interleaved with the loop slots and the module. Loop live state (open?
 *  verdict?) is resolved by the component from GET /loops. */
export function buildSpine(evals: PhaseEval[]): SpineNode[] {
  const raw = PHASES.map((p) => ({ phase: p, status: phaseStatus(p, evals) }));

  const nodes: SpineNode[] = [];
  let brokeAt = -1; // index of the first phase that isn't raw-done
  raw.forEach((r, i) => { if (brokeAt === -1 && r.status !== 'done') brokeAt = i; });

  raw.forEach((r, i) => {
    const contiguousDone = brokeAt === -1 || i < brokeAt;
    let status: PhaseDisplayStatus;
    if (contiguousDone) status = 'done';
    else if (r.status === 'done') status = 'ahead';       // evidence complete, but blocked earlier
    else if (i === brokeAt) status = 'active';            // the phase actually in play
    else status = r.status === 'active' ? 'active' : 'pending';

    const { passed, total } = phaseEvidence(r.phase, evals);
    nodes.push({ kind: 'phase', n: r.phase.n, label: r.phase.label, status, passed, total });
    if (r.phase.moduleAfter) nodes.push({ kind: 'module', label: 'Financial & Pitch Assets' });
    if (r.phase.loopAfter) nodes.push({ kind: 'loop', loopNumber: r.phase.loopAfter });
  });
  return nodes;
}
