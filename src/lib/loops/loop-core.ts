/**
 * Loop core — the loop-number-agnostic primitives shared by every validation
 * loop (Loop 2+). Loop 1 (loop1-psf.ts) predates this file and keeps its own
 * battle-tested copies UNCHANGED — the shared route/reject dispatchers call
 * Loop 1's originals for loop_number 1 and these generics for 2+, so the live
 * PSF loop's runtime path is byte-for-byte what it was.
 *
 * The `validation_loops` table was built generic from day one
 * (loop_number CHECK BETWEEN 1 AND 4, a per-(project,loop_number) one-open-loop
 * unique index) — these helpers just parameterize the SQL Loop 1 already runs.
 */

import { get, run } from '@/lib/db';
import { recordEvent, type EventType } from '@/lib/memory/events';

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface LoopSignal { signal: string; value: number; threshold: number; passed: boolean; }

export interface ValidationLoopRow {
  id: string;
  project_id: string;
  loop_number: number;
  iteration: number;
  status: 'proposed' | 'active' | 'in_review' | 'closed';
  trigger: 'auto' | 'manual';
  loop_score: unknown;
  scope: unknown;
  verdict: 'GO' | 'PIVOT' | 'STOP' | null;
  pending_action_id: string | null;
}

/** Thrown when a verdict targets a loop that doesn't exist in the project —
 *  the route maps it to a 404 instead of echoing an unstored verdict. */
export class LoopNotFoundError extends Error {}

/** Postgres unique_violation — the one-open-loop race gate's expected loss. */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === '23505';
}

/** The open (proposed/active/in_review) loop N row for a project, if any. */
export async function openLoop(projectId: string, loopNumber: number): Promise<ValidationLoopRow | undefined> {
  return get<ValidationLoopRow>(
    `SELECT * FROM validation_loops
      WHERE project_id = ? AND loop_number = ? AND status IN ('proposed','active','in_review')
      ORDER BY created_at DESC LIMIT 1`,
    projectId, loopNumber,
  );
}

/** True while an open loop N gates its downstream phase. */
export async function hasOpenLoop(projectId: string, loopNumber: number): Promise<boolean> {
  return !!(await openLoop(projectId, loopNumber));
}

/** loop_number for a loop id — the dispatcher for the shared verdict/override
 *  route (n=1 → Loop 1's originals, n≥2 → these generics). null if not found. */
export async function loopNumberFor(projectId: string, loopId: string): Promise<number | null> {
  const r = await get<{ loop_number: number }>(
    `SELECT loop_number FROM validation_loops WHERE id = ? AND project_id = ?`, loopId, projectId,
  );
  return r ? Number(r.loop_number) : null;
}

/** Best-effort compensation half: retire a card created for a loop being rolled
 *  back. Direct status flip (the card was never surfaced as decidable) — must
 *  not throw mid-compensation. */
export async function retireOrphanCard(pendingActionId: string | undefined): Promise<void> {
  if (!pendingActionId) return;
  await run(
    `UPDATE pending_actions SET status = 'rejected' WHERE id = ? AND status IN ('pending','edited')`,
    pendingActionId,
  ).catch((e) => console.warn('[loop-core] orphan-card retire failed:', (e as Error).message));
}

/**
 * Ignore-with-motivation. Closes the loop as overridden and records the reason
 * so the auto-trigger doesn't re-nag. Emits `loop{N}_override` ONLY on a landed
 * update (an already-closed / hand-crafted / orphan-card id is a no-op) — the
 * event is the permanent "no re-nag" guard, so a no-op must not fire it. The
 * loop's number is read from the RETURNING row, so the right event type fires.
 */
export async function overrideLoop(projectId: string, loopId: string, ownerUserId: string, motivation: string): Promise<void> {
  const updated = await run(
    `UPDATE validation_loops SET status = 'closed', override_motivation = ?, closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status <> 'closed'
      RETURNING loop_number`,
    motivation.slice(0, 1000), loopId, projectId,
  );
  if (updated.length === 0) return;
  const ln = Number((updated[0] as { loop_number: number }).loop_number);
  await recordEvent({
    userId: ownerUserId, projectId, eventType: `loop${ln}_override` as EventType,
    payload: { loop_id: loopId, motivation: motivation.slice(0, 500) },
  });
}

/**
 * Record the founder's GO/PIVOT/STOP verdict and close the loop. Idempotent:
 * only the FIRST verdict on an open loop is recorded (the verdict card is a
 * persisted chat option-set whose "consumed" lock is client state, so a reload
 * re-renders it clickable). A second click returns the stored verdict — callers
 * use the RETURNED value for the confirmation so it can never contradict record.
 */
export async function recordLoopVerdict(
  projectId: string, loopId: string, ownerUserId: string, verdict: 'GO' | 'PIVOT' | 'STOP',
): Promise<'GO' | 'PIVOT' | 'STOP'> {
  const cur = await get<{ status: string; verdict: 'GO' | 'PIVOT' | 'STOP' | null; loop_number: number }>(
    `SELECT status, verdict, loop_number FROM validation_loops WHERE id = ? AND project_id = ?`, loopId, projectId,
  );
  if (!cur) throw new LoopNotFoundError(`loop ${loopId} not found in project ${projectId}`);
  if (cur.status === 'closed' && cur.verdict) return cur.verdict; // already decided — idempotent
  const updated = await run(
    `UPDATE validation_loops SET verdict = ?, status = 'closed', closed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND project_id = ? AND status <> 'closed'
      RETURNING verdict`,
    verdict, loopId, projectId,
  );
  if (updated.length === 0) {
    // Lost the race, or closed WITHOUT a verdict (override / signal-recovery).
    // Emit NO event and return what's actually stored.
    const stored = await get<{ verdict: 'GO' | 'PIVOT' | 'STOP' | null }>(
      `SELECT verdict FROM validation_loops WHERE id = ? AND project_id = ?`, loopId, projectId,
    );
    return stored?.verdict ?? verdict;
  }
  const ln = Number(cur.loop_number);
  await recordEvent({ userId: ownerUserId, projectId, eventType: `loop${ln}_verdict` as EventType, payload: { loop_id: loopId, verdict } });
  return verdict;
}
