/**
 * Stage transition history (gap 5) — the 7-stage journey is recomputed every
 * turn (single source of truth) and never persisted, so there was no way to
 * answer "when did Stage 1 close?" or diff progress week-over-week. This keeps
 * an APPEND-ONLY `stage_events` log: the evaluator stays pure (evaluateAllStages
 * writes nothing); the write lives HERE, in the caller, and only inserts a row
 * when a check or stage verdict actually CHANGED from what was last recorded.
 *
 * Idempotent + non-throwing: safe to call on every stages recompute (e.g. the
 * stages GET) — a no-change recompute inserts nothing.
 */
import crypto from 'crypto';
import { query, run } from '@/lib/db';
import type { StageEvaluation } from './types';

interface StageEventRow { stage_id: string; check_id: string | null; to_status: string; }

/** Flatten evaluations into the (stage_id, check_id|null) → status pairs we track. */
function currentStates(evaluations: StageEvaluation[]): StageEventRow[] {
  const rows: StageEventRow[] = [];
  for (const ev of evaluations) {
    // Whole-stage verdict (check_id NULL).
    rows.push({ stage_id: ev.stage.id, check_id: null, to_status: ev.status });
    // Per-check pass/fail.
    for (const r of ev.results) {
      rows.push({ stage_id: ev.stage.id, check_id: r.check.id, to_status: r.result.passed ? 'pass' : 'fail' });
    }
  }
  return rows;
}

/**
 * Compare the freshly-computed stage state against the last recorded state and
 * append a stage_events row for each change. Suppresses the initial all-'fail'
 * baseline of a brand-new project: a check with no prior row is recorded only
 * when it is already green ('pass'), and a stage only when it is past 'pending'.
 */
export async function recordStageTransitions(
  projectId: string,
  evaluations: StageEvaluation[],
): Promise<number> {
  try {
    // Latest recorded status per (stage_id, check_id) for this project.
    const prior = await query<StageEventRow>(
      `SELECT DISTINCT ON (stage_id, COALESCE(check_id, '')) stage_id, check_id, to_status
         FROM stage_events
        WHERE project_id = ?
        ORDER BY stage_id, COALESCE(check_id, ''), occurred_at DESC`,
      projectId,
    );
    const lastOf = new Map<string, string>();
    for (const p of prior) lastOf.set(`${p.stage_id}::${p.check_id ?? ''}`, p.to_status);

    const changed: Array<StageEventRow & { from: string | null }> = [];
    for (const cur of currentStates(evaluations)) {
      const key = `${cur.stage_id}::${cur.check_id ?? ''}`;
      const last = lastOf.get(key) ?? null;
      if (last === cur.to_status) continue; // no change
      if (last === null) {
        // First observation: only worth a row if it represents PROGRESS, not the
        // day-one baseline. A brand-new project already has Stage 1 'active' and
        // every check failing — so a check is progress only when already 'pass',
        // and a stage only when already 'done' ("closed"). 'active'/'pending'
        // first-observations are the baseline and stay silent.
        const isProgress = cur.check_id ? cur.to_status === 'pass' : cur.to_status === 'done';
        if (!isProgress) continue;
      }
      changed.push({ ...cur, from: last });
    }

    for (const c of changed) {
      const ev = evaluations.find((e) => e.stage.id === c.stage_id);
      await run(
        `INSERT INTO stage_events (id, project_id, stage_id, stage_number, check_id, from_status, to_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        `se_${crypto.randomUUID().slice(0, 12)}`,
        projectId,
        c.stage_id,
        ev?.stage.number ?? null,
        c.check_id,
        c.from,
        c.to_status,
      );
    }
    return changed.length;
  } catch (err) {
    console.warn('[stage-history] recordStageTransitions failed (non-fatal):', (err as Error).message);
    return 0;
  }
}
