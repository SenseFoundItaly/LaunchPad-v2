/**
 * The IRL high-water floor — persistence for #296.
 *
 * Founder spec (2026-07-23): *"l'IRL non regredisce. Potrebbe scendere solo in
 * caso di pivot pesante… se costringe il founder a tornare indietro e rifare un
 * intero stage daccapo."* The shipped ladder did the opposite: it recomputed
 * from scratch on every read, so a project slid 4 → 2 on any signal dip with no
 * pivot involved.
 *
 * What counts as a "pivot pesante" was the reason this sat unbuilt — it had no
 * definition. It has one now: a **PIVOT verdict**, on the Validation Gate or on
 * a validation loop, is the founder explicitly declaring the work must be
 * redone. That is the trigger, and nothing else clears the floor.
 *
 * Stored in `projects.settings` (an existing JSONB bag) rather than a new
 * column, deliberately: staging has no `_migrations` ledger, so every migration
 * is a manual step there. A jsonb merge keeps other settings keys intact —
 * never assign the whole object.
 */

import { query, run } from '@/lib/db';
import type { IrlFloor } from './ladder';

const KEY = 'irl_high_water';

/** Read the stored floor. Absent/garbage → no floor (fails OPEN: the founder
 *  sees live evidence, never an invented level). */
export async function readIrlFloor(projectId: string): Promise<IrlFloor> {
  const rows = await query<{ v: number | string | null }>(
    `SELECT settings->>'${KEY}' AS v FROM projects WHERE id = ?`,
    projectId,
  ).catch(() => [] as { v: number | string | null }[]);
  const raw = rows[0]?.v;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return { level: typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : null };
}

/**
 * Raise the floor to `level` if it is higher than what's stored. Monotonic by
 * construction — `GREATEST` in SQL, so concurrent readers can't lower it, and
 * a stale read can't clobber a newer high.
 */
export async function raiseIrlFloor(projectId: string, level: number): Promise<void> {
  if (!Number.isFinite(level) || level <= 0) return;
  await run(
    `UPDATE projects
        SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object(
              '${KEY}', GREATEST(COALESCE((settings->>'${KEY}')::int, 0), ?::int))
      WHERE id = ?`,
    Math.floor(level),
    projectId,
  ).catch((err) => console.warn('[irl-floor] raise failed (non-fatal):', (err as Error).message));
}

/**
 * Clear the floor — the founder called PIVOT, so the index is allowed to fall
 * back to whatever the live evidence supports and re-accumulate from there.
 *
 * Non-fatal: a failure here leaves the floor high, which is the SAFE direction
 * (the number is stale-high rather than wrongly collapsed) and self-heals on
 * the next successful pivot.
 */
export async function clearIrlFloor(projectId: string): Promise<void> {
  await run(
    `UPDATE projects SET settings = COALESCE(settings, '{}'::jsonb) - '${KEY}' WHERE id = ?`,
    projectId,
  ).catch((err) => console.warn('[irl-floor] clear failed (non-fatal):', (err as Error).message));
}
