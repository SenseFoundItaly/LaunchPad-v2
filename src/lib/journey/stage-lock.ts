/**
 * Stage-sequence lock (founder directive 2026-07-13): the execution stages —
 * Build & Launch (5), Fundraise (6), Operate (7) — are LOCKED until every
 * earlier stage is complete ('done'). A founder should not spin up an MVP,
 * pitch investors, or run ops dashboards before the idea is validated, the
 * persona is proven, and the business model is scored.
 *
 * This is a HARD gate on RUNNING those stages' skills (mirrors the canvas +
 * 1C run gates in the skills route). It does NOT block conversation — the
 * founder can always talk, and the message names exactly which earlier stage
 * to finish, so there is never a dead-end (consistent with "the system can't
 * block the founder", which is about EARLY validation, not gating advanced
 * execution behind it).
 *
 * The journey already models sequence: activeStage = the first non-'done'
 * stage, so "all stages before N are done" ⟺ activeStage.number >= N.
 */
import { STAGES } from '@/lib/stages';
import { buildProjectSnapshot } from './snapshot';
import { evaluateAllStages, activeStage } from './index';

/** First stage that is sequence-locked. Stages 1-4 are never locked by this rule. */
export const LOCK_FROM_STAGE = 5;

/** Map a skill id to its pipeline stage number (1-7), or null if not a staged skill. */
export function stageNumberForSkill(skillId: string): number | null {
  for (const stage of STAGES) {
    if (stage.skills.some((s) => s.id === skillId)) return stage.number;
  }
  return null;
}

export interface StageLockResult {
  locked: boolean;
  /** The stage the skill belongs to (when it is a staged skill ≥ LOCK_FROM_STAGE). */
  skillStage?: number;
  skillStageName?: string;
  /** The earliest not-yet-done stage the founder must complete first. */
  blockingStage?: number;
  blockingStageName?: string;
  /** Progress on the blocking stage — for a localized "X/Y checks done" message. */
  blockingPassed?: number;
  blockingTotal?: number;
  /** English message — used for the agent-facing propose-time signal. The
   *  founder-facing surface localizes from the structured fields instead. */
  message?: string;
}

const NOT_LOCKED: StageLockResult = { locked: false };

/**
 * Decide whether running `skillId` is blocked by the stage-sequence lock.
 * Non-throwing: on any snapshot failure we FAIL OPEN (return not-locked) — a
 * lock bug must never wedge a founder out of their own skills.
 */
export async function stageSequenceLock(
  projectId: string,
  skillId: string,
): Promise<StageLockResult> {
  const skillStage = stageNumberForSkill(skillId);
  if (skillStage === null || skillStage < LOCK_FROM_STAGE) return NOT_LOCKED;

  try {
    const snapshot = await buildProjectSnapshot(projectId);
    const evaluations = evaluateAllStages(snapshot);
    const active = activeStage(evaluations);
    // All stages before skillStage are done ⟺ the active (first non-done) stage
    // is at or beyond skillStage. If active is earlier, an earlier stage is open.
    if (active.stage.number >= skillStage) return NOT_LOCKED;

    const skillStageName = STAGES.find((s) => s.number === skillStage)?.name ?? `Stage ${skillStage}`;
    return {
      locked: true,
      skillStage,
      skillStageName,
      blockingStage: active.stage.number,
      blockingStageName: active.stage.label,
      blockingPassed: active.passed,
      blockingTotal: active.total,
      message:
        `${skillStageName} is locked until every earlier stage is complete. ` +
        `You're currently on Stage ${active.stage.number} — ${active.stage.label} ` +
        `(${active.passed}/${active.total} checks done). Finish it and any remaining ` +
        `stages before Stage ${skillStage}, then this unlocks. Nothing here is lost — ` +
        `complete the work ahead of it and come back.`,
    };
  } catch (err) {
    console.warn('[stage-lock] failed (fail-open):', (err as Error).message);
    return NOT_LOCKED;
  }
}
