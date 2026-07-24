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

export type SpineNode =
  | { kind: 'phase'; n: number; label: string; status: PhaseStatus }
  | { kind: 'module'; label: string }
  | { kind: 'loop'; loopNumber: number };

/** The ordered spine: phases with computed status, interleaved with the loop
 *  slots and the module — the live-data mirror of the demo's SPINE. Loop/module
 *  live state (open? verdict?) is resolved by the component from GET /loops. */
export function buildSpine(evals: PhaseEval[]): SpineNode[] {
  const nodes: SpineNode[] = [];
  for (const phase of PHASES) {
    nodes.push({ kind: 'phase', n: phase.n, label: phase.label, status: phaseStatus(phase, evals) });
    if (phase.moduleAfter) nodes.push({ kind: 'module', label: 'Financial & Pitch Assets' });
    if (phase.loopAfter) nodes.push({ kind: 'loop', loopNumber: phase.loopAfter });
  }
  return nodes;
}
