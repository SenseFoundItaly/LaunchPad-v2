/**
 * Stages — public API.
 *
 * `evaluateAllStages(snapshot)` runs every stage's checks against the project
 * snapshot and returns ordered StageEvaluations with status (done/active/
 * pending). The first stage that isn't done becomes "active".
 */

import type { ProjectSnapshot, Stage, StageEvaluation } from './types';
import { stageIdeaValidation } from './stage-1-idea-validation';
import { stageMarketValidation } from './stage-2-market-validation';
import { stagePersona } from './stage-3-persona';
import { stageBusinessModel } from './stage-4-business-model';
import { stageBuildLaunch } from './stage-5-build-launch';
import { stageFundraise } from './stage-6-fundraise';
import { stageOperate } from './stage-7-operate';

export { buildProjectSnapshot, countMemoryFactsMatching } from './snapshot';
// Canonical id/number/label source of truth — import from here (or from
// './canonical' directly in client code) instead of hardcoding stage names.
export {
  CANONICAL_STAGES,
  CANONICAL_BY_ID,
  canonicalStageLabel,
  canonicalStageId,
} from './canonical';
export type { CanonicalStage } from './canonical';
export type {
  StageId,
  StageCheck,
  CheckResult,
  Stage,
  StageEvaluation,
  ProjectSnapshot,
} from './types';

export const STAGES: Stage[] = [
  stageIdeaValidation,
  stageMarketValidation,
  stagePersona,
  stageBusinessModel,
  stageBuildLaunch,
  stageFundraise,
  stageOperate,
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
