/**
 * Stages — public API.
 *
 * `evaluateAllStages(snapshot)` runs every stage's checks against the project
 * snapshot and returns ordered StageEvaluations with status (done/active/
 * pending). The first stage that isn't done becomes "active".
 */

import type { ProjectSnapshot, Stage, StageEvaluation } from './types';
import { stageSpark } from './stage-1-spark';
import { stageProblem } from './stage-2-problem';
import { stageSolution } from './stage-3-solution';
import { stageSegment } from './stage-4-segment';
import { stageMvp } from './stage-5-mvp';
import { stagePricing } from './stage-6-pricing';
import { stageGrowth } from './stage-7-growth';

export { buildProjectSnapshot, countMemoryFactsMatching } from './snapshot';
export type {
  StageId,
  StageCheck,
  CheckResult,
  Stage,
  StageEvaluation,
  ProjectSnapshot,
} from './types';

export const STAGES: Stage[] = [
  stageSpark,
  stageProblem,
  stageSolution,
  stageSegment,
  stageMvp,
  stagePricing,
  stageGrowth,
];

export function evaluateAllStages(snapshot: ProjectSnapshot): StageEvaluation[] {
  // First pass — run all checks, record pass counts.
  const raw = STAGES.map((stage) => {
    const results = stage.checks.map((check) => ({
      check: { id: check.id, label: check.label, source: check.source },
      result: check.evaluate(snapshot),
    }));
    const passed = results.filter((r) => r.result.passed).length;
    return { stage, passed, total: stage.checks.length, results };
  });

  // Second pass — assign status. First non-done stage = active; everything
  // after that = pending. Earlier non-done stages also marked active so the
  // founder can backfill (we don't gate forward progress on perfection).
  let activeAssigned = false;
  return raw.map(({ stage, passed, total, results }): StageEvaluation => {
    let status: StageEvaluation['status'];
    if (passed === total) {
      status = 'done';
    } else if (!activeAssigned) {
      status = 'active';
      activeAssigned = true;
    } else {
      status = 'pending';
    }
    return { stage, passed, total, status, results };
  });
}

/** Convenience — returns the single active StageEvaluation, or the last
 *  done stage if everything is complete. Used by Home/Dashboard headlines. */
export function activeStage(evaluations: StageEvaluation[]): StageEvaluation {
  return evaluations.find((e) => e.status === 'active') ?? evaluations[evaluations.length - 1];
}
