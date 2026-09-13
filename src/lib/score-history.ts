/**
 * Score history — append-only trajectory for the startup score. `scores` is a
 * single overwrite-in-place row (current state only); this records each real
 * scoring so "my score went 5.2 → 7.1" is answerable. Non-throwing: a history
 * write must never block the score update it shadows.
 */
import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

export async function recordScoreHistory(
  projectId: string,
  overallScore: number,
  source: string,
  recommendation?: string | null,
): Promise<void> {
  // Only real scorings (>0); the dimensions-only writes pass 0 and aren't events.
  if (!Number.isFinite(overallScore) || overallScore <= 0) return;
  try {
    // Repeated chart artifacts are display noise, but an official scoring run
    // is evidence even when its number is unchanged. Both the 1B freshness
    // check and the post-interview review need the time of that real rerun.
    const last = await get<{ overall_score: number; source: string | null }>(
      `SELECT overall_score, source FROM score_history WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      projectId,
    );
    // Skip only a TRUE no-change: same number AND same source. A startup run
    // landing on the same integer as the old clarity run is a kind change —
    // without a row, GET /score keeps labeling fresh Startup dimensions
    // "Clarity Score" (48h audit).
    if (source !== 'startup-scoring' && last && Math.round(last.overall_score * 100) === Math.round(overallScore * 100) && last.source === source) return;
    await run(
      `INSERT INTO score_history (id, project_id, overall_score, recommendation, source)
       VALUES (?, ?, ?, ?, ?)`,
      generateId('sch'), projectId, overallScore, recommendation ?? null, source,
    );
  } catch (err) {
    console.warn('[score-history] append failed (non-fatal):', (err as Error).message);
  }
}

export interface ScorePoint { overall_score: number; recommendation: string | null; source: string | null; created_at: string; }

/** Score trajectory oldest→newest for a project (for a sparkline / delta). */
export async function getScoreHistory(projectId: string, limit = 50): Promise<ScorePoint[]> {
  try {
    const rows = await query<ScorePoint>(
      `SELECT overall_score, recommendation, source, created_at
         FROM score_history WHERE project_id = ?
        ORDER BY created_at ASC LIMIT ?`,
      projectId, limit,
    );
    return rows;
  } catch {
    return [];
  }
}
