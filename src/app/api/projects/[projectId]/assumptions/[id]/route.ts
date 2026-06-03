import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { run } from '@/lib/db';
import {
  getAssumption,
  markValidated,
  markInvalidated,
  type AssumptionStatus,
} from '@/lib/assumptions';

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'open', 'validated', 'invalidated', 'accepted_risk',
]);

/**
 * GET /api/projects/:projectId/assumptions/:id — single assumption row.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; id: string }> },
) {
  const { projectId, id } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const row = await getAssumption(id);
  if (!row || row.project_id !== projectId) return error('not found', 404);

  return json(row);
}

/**
 * PATCH /api/projects/:projectId/assumptions/:id
 *
 * Body shapes:
 *   { status: "validated", evidence: "string" }     — founder-confirmed
 *   { status: "invalidated", reason: "string" }     — founder-disconfirmed
 *   { status: "accepted_risk", reason: "string" }   — knowingly accept
 *   { status: "open" }                               — reopen
 *   { criticality: "high|medium|low" }              — adjust severity
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; id: string }> },
) {
  const { projectId, id } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const existing = await getAssumption(id);
  if (!existing || existing.project_id !== projectId) return error('not found', 404);

  let body: { status?: unknown; evidence?: unknown; reason?: unknown; criticality?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('invalid JSON body');
  }

  if (typeof body.status === 'string') {
    if (!VALID_STATUSES.has(body.status)) return error('invalid status');
    const status = body.status as AssumptionStatus;

    if (status === 'validated') {
      const evidence = typeof body.evidence === 'string' ? body.evidence : 'founder-confirmed';
      // Founder-confirmed validations have no skill_completion link.
      await markValidated(id, null, evidence);
    } else if (status === 'invalidated') {
      const reason = typeof body.reason === 'string' ? body.reason : 'founder-disconfirmed';
      await markInvalidated(id, reason);
    } else if (status === 'accepted_risk') {
      const reason = typeof body.reason === 'string' ? body.reason : 'founder-accepted';
      await run(
        `UPDATE assumptions
         SET status = 'accepted_risk',
             invalidated_reason = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        reason, id,
      );
    } else if (status === 'open') {
      await run(
        `UPDATE assumptions
         SET status = 'open',
             validated_by_skill_completion_id = NULL,
             validated_at = NULL,
             invalidated_at = NULL,
             invalidated_reason = NULL,
             validation_evidence = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        id,
      );
    }
  }

  if (typeof body.criticality === 'string') {
    if (!['high', 'medium', 'low'].includes(body.criticality)) {
      return error('invalid criticality');
    }
    await run(
      `UPDATE assumptions SET criticality = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      body.criticality, id,
    );
  }

  const updated = await getAssumption(id);
  return json(updated);
}

/**
 * DELETE /api/projects/:projectId/assumptions/:id
 * Hard delete — use sparingly. Prefer PATCH to `accepted_risk` for "ignore".
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; id: string }> },
) {
  const { projectId, id } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const existing = await getAssumption(id);
  if (!existing || existing.project_id !== projectId) return error('not found', 404);

  await run('DELETE FROM assumptions WHERE id = ?', id);
  return json({ deleted: id });
}
