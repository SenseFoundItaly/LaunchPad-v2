/**
 * Idea Canvas versioning — the Loop-1 "diff visuale v1/v2" the spec mandates.
 *
 * Iteration Cycle, Loop 1 "Output del Loop":
 *   "PSF vN: ICP, value prop, problem statement aggiornati — persistiti in
 *    Knowledge con versioning"
 *   "Diff visuale v1/v2: visualizzazione esplicita di cosa è cambiato E PERCHÉ"
 *
 * `idea_canvas` is one row per project, overwritten in place, so after a pivot
 * the founder's original framing is simply gone. Two 1C steps depend on being
 * able to see the change — "Solution described in-depth (aggiornata sulla base
 * degli insight)" and "Value proposition sharpened" — and neither is
 * distinguishable from the starting canvas without a before.
 *
 * Split deliberately: `diffCanvas` is PURE (no DB, no i18n), so the comparison
 * logic is testable on its own and the same function serves any renderer.
 */

import { query, run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { coerceJson } from '@/lib/jsonb';

/** The canvas fields worth versioning — the founder-authored ones. Ordered as
 *  the Lean Canvas reads, so a diff renders in a familiar sequence. */
export const VERSIONED_CANVAS_FIELDS = [
  'problem', 'solution', 'target_market', 'value_proposition',
  'competitive_advantage', 'unfair_advantage', 'business_model', 'channels',
  'key_metrics', 'revenue_streams', 'cost_structure',
] as const;

export type VersionedCanvasField = typeof VERSIONED_CANVAS_FIELDS[number];
export type CanvasPayload = Partial<Record<VersionedCanvasField, string | string[] | null>>;

/** Why a snapshot was taken. The spec asks the diff to show what changed AND
 *  why, so the reason is captured at write time — it cannot be reconstructed. */
export type CanvasVersionReason =
  | 'loop_1_open'    // before a PSF review starts revising the canvas
  | 'loop_1_close'   // after the founder's verdict, the revised state
  | 'gate_pivot'     // a Validation Gate PIVOT reopened the canvas
  | 'manual';

export interface CanvasVersion {
  id: string;
  version_number: number;
  canvas: CanvasPayload;
  reason: CanvasVersionReason;
  loop_id: string | null;
  created_at: string;
}

export interface FieldChange {
  field: VersionedCanvasField;
  before: string | null;
  after: string | null;
  /** 'added' when there was nothing before, 'removed' when nothing after. */
  kind: 'added' | 'removed' | 'changed';
}

/** Arrays render as one entry per line so a diff is readable field-by-field. */
function normalize(v: string | string[] | null | undefined): string | null {
  if (Array.isArray(v)) {
    const items = v.map((x) => String(x).trim()).filter(Boolean);
    return items.length > 0 ? items.join('\n') : null;
  }
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

/**
 * What changed between two canvas snapshots. Pure.
 *
 * Only reports fields that ACTUALLY differ — an unchanged field is not a
 * change, and listing eleven rows where two moved is the fastest way to make a
 * diff unreadable. Whitespace-only edits are not changes either.
 */
export function diffCanvas(before: CanvasPayload, after: CanvasPayload): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of VERSIONED_CANVAS_FIELDS) {
    const b = normalize(before[field]);
    const a = normalize(after[field]);
    if (b === a) continue;
    out.push({
      field,
      before: b,
      after: a,
      kind: b === null ? 'added' : a === null ? 'removed' : 'changed',
    });
  }
  return out;
}

/** Read the current canvas as a version payload. */
export async function currentCanvas(projectId: string): Promise<CanvasPayload> {
  const row = await get<Record<string, unknown>>(
    `SELECT ${VERSIONED_CANVAS_FIELDS.join(', ')} FROM idea_canvas WHERE project_id = ?`,
    projectId,
  ).catch(() => null);
  if (!row) return {};
  const out: CanvasPayload = {};
  for (const f of VERSIONED_CANVAS_FIELDS) out[f] = (row[f] ?? null) as string | string[] | null;
  return out;
}

/**
 * Capture the canvas as the next version. Non-fatal by construction: a failed
 * snapshot must never block the loop that triggered it — losing a diff is bad,
 * losing the founder's verdict is worse.
 *
 * Skips when the canvas is empty (nothing to compare later) and when the
 * previous version is byte-identical — repeated snapshots of an unchanged
 * canvas turn the history into noise.
 */
export async function captureCanvasVersion(
  projectId: string,
  reason: CanvasVersionReason,
  loopId?: string | null,
): Promise<number | null> {
  try {
    const canvas = await currentCanvas(projectId);
    if (Object.values(canvas).every((v) => normalize(v as string | string[] | null) === null)) return null;

    const prev = await latestCanvasVersion(projectId);
    if (prev && diffCanvas(prev.canvas, canvas).length === 0) return prev.version_number;

    const next = (prev?.version_number ?? 0) + 1;
    await run(
      `INSERT INTO canvas_versions (id, project_id, version_number, canvas, reason, loop_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      // JSONB: bind the RAW object — JSON.stringify double-encodes it.
      generateId('cvers'), projectId, next, canvas, reason, loopId ?? null,
    );
    return next;
  } catch (err) {
    console.warn('[canvas-versions] capture failed (non-fatal):', (err as Error).message);
    return null;
  }
}

function rowToVersion(r: Record<string, unknown>): CanvasVersion {
  return {
    id: String(r.id),
    version_number: Number(r.version_number),
    canvas: (coerceJson<CanvasPayload>(r.canvas) ?? {}) as CanvasPayload,
    reason: String(r.reason) as CanvasVersionReason,
    loop_id: r.loop_id ? String(r.loop_id) : null,
    created_at: String(r.created_at),
  };
}

export async function latestCanvasVersion(projectId: string): Promise<CanvasVersion | null> {
  const r = await get<Record<string, unknown>>(
    `SELECT * FROM canvas_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1`,
    projectId,
  ).catch(() => null);
  return r ? rowToVersion(r) : null;
}

export async function listCanvasVersions(projectId: string): Promise<CanvasVersion[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM canvas_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 20`,
    projectId,
  ).catch(() => []);
  return rows.map(rowToVersion);
}

/**
 * The v1/v2 diff: the newest stored version against the LIVE canvas, so the
 * founder sees what has moved since the snapshot rather than only what moved
 * between two historical points.
 */
export async function diffAgainstCurrent(
  projectId: string,
): Promise<{ from: CanvasVersion | null; changes: FieldChange[] }> {
  const from = await latestCanvasVersion(projectId);
  if (!from) return { from: null, changes: [] };
  return { from, changes: diffCanvas(from.canvas, await currentCanvas(projectId)) };
}
