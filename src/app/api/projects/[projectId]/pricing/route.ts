import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { maybeTriggerLoop2 } from '@/lib/loops/loop2-bm';

/**
 * GET /api/projects/{projectId}/pricing
 *
 * Returns the pricing_state singleton for a project, or null when the
 * founder hasn't started Pricing yet. Mirrors the burn-rate pattern.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const rows = await query(
    'SELECT * FROM pricing_state WHERE project_id = ?',
    projectId,
  );
  return json(rows.length > 0 ? rows[0] : null);
}

/**
 * PUT /api/projects/{projectId}/pricing
 *
 * Upserts the pricing_state row. Body fields are all optional — only the
 * keys present in the payload get written, the rest keep their stored values.
 * JSONB columns (tiers/wtp/unit_econ) accept any object/array shape; schema
 * evolution lives in the consumers, not the DB.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return error('Request body required');
  }

  const existing = await query(
    'SELECT project_id FROM pricing_state WHERE project_id = ?',
    projectId,
  );

  // Allowed fields — anything else in the body is ignored. Matches the
  // pricing_state column set from migration 007.
  const ALLOWED = ['anchor_price', 'currency', 'tiers', 'wtp', 'unit_econ', 'model'] as const;
  const updates: Record<string, unknown> = {};
  for (const k of ALLOWED) {
    if (k in body) updates[k] = body[k];
  }

  if (existing.length === 0) {
    // INSERT — defaults from the migration handle the unset columns.
    const cols = ['project_id', ...Object.keys(updates), 'updated_at'];
    const placeholders = cols.map(() => '?').join(', ');
    const values: unknown[] = [
      projectId,
      ...Object.values(updates).map(serializeJsonb),
      new Date().toISOString(),
    ];
    await run(
      `INSERT INTO pricing_state (${cols.join(', ')}) VALUES (${placeholders})`,
      ...values,
    );
  } else if (Object.keys(updates).length > 0) {
    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values: unknown[] = [
      ...Object.values(updates).map(serializeJsonb),
      new Date().toISOString(),
      projectId,
    ];
    await run(
      `UPDATE pricing_state SET ${setClauses}, updated_at = ? WHERE project_id = ?`,
      ...values,
    );
  }

  // Loop 2 (BM Stress Test): a pricing/unit-econ change may push LTV/CAC below
  // the 3× stress bar (or, on a re-run, recover it). Awaited (idempotent,
  // non-throwing, self-guards on missing unit econ) so the serverless freeze
  // can't drop it — mirror of the set_pricing tool hook.
  await maybeTriggerLoop2(projectId);

  const [row] = await query('SELECT * FROM pricing_state WHERE project_id = ?', projectId);
  return json(row ?? null);
}

/** JSONB columns must be serialized to strings for the postgres.js driver
 *  when passed through `?` placeholders. Primitives pass through unchanged. */
// JSONB bind: pass the RAW value. postgres.js single-encodes objects/arrays into
// JSONB; JSON.stringify here stored a double-encoded string scalar (read back as a
// string by pricing readers). See pending-actions.ts:505 / src/lib/jsonb.ts.
function serializeJsonb(v: unknown): unknown {
  return v ?? null;
}
