/**
 * Stages — public API.
 *
 * `evaluateAllStages(snapshot)` runs every stage's checks against the project
 * snapshot and returns ordered StageEvaluations with status (done/active/
 * pending). The first stage that isn't done becomes "active".
 */

import type { ProjectSnapshot, Stage, StageEvaluation } from './types';
import { buildProjectSnapshot } from './snapshot';
import { stageIdeaValidation } from './stage-1-idea-validation';
import { stageMarketValidation } from './stage-2-market-validation';
import { stagePersona } from './stage-3-persona';
import { stageBusinessModel } from './stage-4-business-model';
import { stageBuildLaunch } from './stage-5-build-launch';
import { stageFundraise } from './stage-6-fundraise';
import { stageOperate } from './stage-7-operate';

export { buildProjectSnapshot, countMemoryFactsMatching, keywordMatcher } from './snapshot';
// Shared with the save_memory_fact spine-moving gate (project-tools.ts) — one
// list, so the gate and the market_size check can never drift again.
export { MARKET_SIZE_KEYWORDS } from './stage-2-market-validation';
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

/**
 * Resolve the ACTUAL proof content a passed check read, from its `source`
 * pointer + the snapshot. Generic (one resolver, no per-check edits) — the
 * `source` strings already declare where the evidence lives:
 *   - "idea_canvas.<field>" → that canvas field's text
 *   - anything mentioning "competitor"/"competitor_profiles" → the mapped names
 * Returns undefined for sources we can't resolve to concrete text (e.g.
 * keyword fact searches), in which case the UI keeps the evidence sentence.
 */
function resolveProof(source: string, snapshot: ProjectSnapshot): string | undefined {
  const canvasMatch = source.match(/idea_canvas\.(\w+)/);
  if (canvasMatch && snapshot.idea_canvas) {
    const field = canvasMatch[1];
    const v = (snapshot.idea_canvas as Record<string, unknown>)[field];
    if (typeof v === 'string' && v.trim()) return v.trim();
    // Array-backed blocks (cost_structure, revenue_streams, key_metrics).
    // cost_revenue_defined points at cost_structure but proves BOTH lists.
    if (Array.isArray(v) && v.length > 0) {
      const items = v.filter((x): x is string => typeof x === 'string');
      if (field === 'cost_structure' && snapshot.idea_canvas.revenue_streams?.length) {
        return `Costs: ${items.join(' · ')} — Revenue: ${snapshot.idea_canvas.revenue_streams.join(' · ')}`;
      }
      return items.join(' · ');
    }
  }
  // Whole-canvas source (lean_canvas_compiled) → summarize the filled blocks.
  if (source === 'idea_canvas' && snapshot.idea_canvas) {
    const c = snapshot.idea_canvas;
    const parts = [
      c.problem && `Problem: ${c.problem}`,
      c.solution && `Solution: ${c.solution}`,
      c.target_market && `Segments: ${c.target_market}`,
      c.value_proposition && `Value prop: ${c.value_proposition}`,
      (c.unfair_advantage || c.competitive_advantage) && `Unfair advantage: ${c.unfair_advantage || c.competitive_advantage}`,
      c.channels && `Channels: ${c.channels}`,
      c.key_metrics?.length && `Key metrics: ${c.key_metrics.join(' · ')}`,
      c.cost_structure?.length && `Costs: ${c.cost_structure.join(' · ')}`,
      c.revenue_streams?.length && `Revenue: ${c.revenue_streams.join(' · ')}`,
    ].filter(Boolean);
    return parts.length ? (parts as string[]).join('\n') : undefined;
  }
  if (source === 'scores.overall_score' && snapshot.startup_score) {
    const raw = snapshot.startup_score.overall_score;
    const score10 = raw > 10 ? raw / 10 : raw;
    const when = snapshot.startup_score.scored_at ? ` (scored ${String(snapshot.startup_score.scored_at).slice(0, 10)})` : '';
    return `Startup Scoring baseline: ${score10.toFixed(1)}/10${when}`;
  }
  if (/competitor/i.test(source) && snapshot.competitors.length > 0) {
    return snapshot.competitors.map((c) => c.name).filter(Boolean).join(', ');
  }
  return undefined;
}

export function evaluateAllStages(snapshot: ProjectSnapshot): StageEvaluation[] {
  // First pass — run all checks, record pass counts.
  const raw = STAGES.map((stage) => {
    const results = stage.checks.map((check) => {
      const result = check.evaluate(snapshot);
      // Enrich a PASSED check with the concrete proof it read, so the UI can
      // show the founder the actual evidence (not just "you did this").
      if (result.passed && result.proof === undefined) {
        const proof = resolveProof(check.source, snapshot);
        if (proof) result.proof = proof;
      }
      return { check: { id: check.id, label: check.label, source: check.source, track: check.track }, result };
    });
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
    // Gap B: the execution stages (Build & Launch 5, Fundraise 6, Operate 7)
    // are SEQUENCE-LOCKED until earlier stages are done — which is exactly when
    // they're 'pending'. Mark their checks locked so the spine renders the 🔒
    // affordance (matching the run-gate in stage-lock.ts) instead of dangling
    // actionable gaps a founder can't act on yet. Threshold inlined (5) to avoid
    // an index↔stage-lock import cycle; kept in sync with LOCK_FROM_STAGE.
    if (status === 'pending' && stage.number >= 5) {
      for (const r of results) {
        if (!r.result.passed) r.result.locked = true;
      }
    }
    return { stage, passed, total, status, results };
  });
}

/** Convenience — returns the single active StageEvaluation, or the last
 *  done stage if everything is complete. Used by Home/Dashboard headlines. */
export function activeStage(evaluations: StageEvaluation[]): StageEvaluation {
  return evaluations.find((e) => e.status === 'active') ?? evaluations[evaluations.length - 1];
}

/**
 * SINGLE SOURCE OF TRUTH for "what stage is this project on."
 *
 * Use this ANYWHERE you would be tempted to read the legacy
 * `projects.current_step` column for stage display. That column belongs to a
 * retired 5-stage taxonomy (idea/mvp/pmf/growth/scale) and is NOT advanced when
 * journey checks pass, so it drifts from the real spine — the root cause of
 * chat narrating "Stage 1 — 0/7" while the spine shows a later stage Validated.
 * This recomputes the active stage from the live evaluator, so it can never lag.
 *
 * Returns null only when the snapshot build fails (missing tables on a brand-new
 * project) — callers should degrade gracefully, never assume a stage.
 */
export async function getActiveStage(projectId: string): Promise<StageEvaluation | null> {
  try {
    const snapshot = await buildProjectSnapshot(projectId);
    return activeStage(evaluateAllStages(snapshot));
  } catch {
    return null;
  }
}

/** Synchronous variant for callers that ALREADY hold a snapshot (e.g. the chat
 *  route builds one once per turn) — reuse it instead of a second DB round-trip. */
export function activeStageFor(snapshot: ProjectSnapshot): StageEvaluation {
  return activeStage(evaluateAllStages(snapshot));
}
