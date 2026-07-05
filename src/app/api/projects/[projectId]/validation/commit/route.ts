import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { query } from '@/lib/db';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import {
  createPendingAction,
  applyPendingAction,
  markActionSent,
  markActionFailed,
} from '@/lib/pending-actions';
import { executeAppliedAction } from '@/lib/action-executors';

const VALID_KINDS = new Set(['canvas_field', 'competitor', 'market_size_fact']);

// Stable, order-independent fingerprint of a commit batch. Two POSTs with the
// same items (a double-click, a retry, a React-strict-mode double render, an SSE
// replay) hash identically so the second can be deduped instead of debiting again.
function commitFingerprint(items: Array<Record<string, unknown>>): string {
  const norm = items
    .map((it) => ({ k: it.kind, f: it.field ?? null, n: it.name ?? null, v: String(it.value).trim() }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 32);
}

/**
 * POST /api/projects/{projectId}/validation/commit
 * Body: { items: Array<{ kind, field?, name?, label?, value, credits?, sources? }> }
 *
 * Deterministic one-click commit of a validation batch from a chat COMMIT
 * OPTION (option.commit.items). A clicked commit option IS the founder's
 * approval, so we create the validation_proposal pending_action and APPLY it in
 * one shot — reusing applyValidationProposal (graph_nodes / memory_facts writes
 * + the combined credit debit) and the same status transitions the inline card
 * uses. This makes PAID items (competitor, market size) persist deterministically
 * instead of depending on the model emitting a card it might only narrate.
 *
 * Canvas-TEXT-only commits use the free POST /idea-canvas path; this endpoint is
 * for batches that include paid knowledge items (it also handles canvas_field
 * items, since applyValidationProposal writes those too).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Body must be JSON', 400);
  }

  const rawItems = Array.isArray(body?.items) ? (body.items as Array<Record<string, unknown>>) : [];
  const items = rawItems.filter(
    (it) =>
      it &&
      typeof it.kind === 'string' &&
      VALID_KINDS.has(it.kind) &&
      typeof it.value === 'string' &&
      (it.value as string).trim().length > 0,
  );
  if (items.length === 0) {
    return error('At least one valid item (kind + non-empty value) is required', 400);
  }

  // A canvas_field item the executor can't route (no valid `field`) would be
  // SILENTLY DROPPED downstream — the exact narrate-but-no-persist failure this
  // loop exists to prevent. Reject it loudly instead. (Canvas text should commit
  // via the free commit.canvas → /idea-canvas path; items is for paid knowledge.)
  const CANVAS_COLS = new Set(['problem', 'solution', 'target_market', 'value_proposition', 'business_model', 'competitive_advantage', 'channels']);
  const badCanvas = items.find(
    (it) => it.kind === 'canvas_field' && !(typeof it.field === 'string' && CANVAS_COLS.has(it.field)),
  );
  if (badCanvas) {
    return error('A canvas_field item must include a valid "field" (problem|solution|target_market|value_proposition|business_model|competitive_advantage|channels) — or commit canvas text via commit.canvas instead', 400);
  }

  // Idempotency guard: this endpoint createPendingAction → apply → DEBITS on
  // EVERY POST. The graph writes are idempotent (ON CONFLICT) but the credit
  // debit is NOT, so a double-click / retry / SSE-replay would charge twice.
  // If an identical item set for this project was already committed (applied or
  // sent) in the last 2 minutes, return that as a no-op WITHOUT a second debit.
  // Window-based de-dup (per the eng review) covers the realistic sequential
  // cases; a true-concurrent race is the separate inherited applyTransition TOCTOU.
  const fingerprint = commitFingerprint(items);
  const dup = await query<{ id: string }>(
    `SELECT id FROM pending_actions
      WHERE project_id = ?
        AND action_type = 'validation_proposal'
        AND payload->>'idempotency_key' = ?
        AND status IN ('applied', 'sent')
        AND created_at > now() - interval '120 seconds'
      ORDER BY created_at DESC
      LIMIT 1`,
    projectId, fingerprint,
  );
  if (dup.length > 0) {
    return json({ committed: items.length, deduped: true, action_id: dup[0].id }, 200);
  }

  // Create the proposal, then apply it — mirrors the actions/[actionId] apply
  // transition (applyPendingAction → executeAppliedAction → markActionSent) so
  // the write, credit debit, and audit row are identical to the card path.
  const action = await createPendingAction({
    project_id: projectId,
    action_type: 'validation_proposal',
    title: 'Committed from chat',
    rationale: 'Founder confirmed via a one-click commit option.',
    payload: { items, idempotency_key: fingerprint },
  });

  try {
    const applied = await applyPendingAction(action.id);
    const result = await executeAppliedAction(applied);
    if (!result.ok) {
      await markActionFailed(action.id, result.error || 'commit handler returned not-ok');
      return error(result.error || 'Commit failed', 422);
    }
    const mode = result.deliverable?.mode;
    if (mode === 'direct' || mode === 'outbox') {
      await markActionSent(action.id, {
        target: mode,
        external_id: result.deliverable?.created_row_id,
        response: result.deliverable?.narrative,
      });
    }
    return json({ committed: items.length, deliverable: result.deliverable }, 201);
  } catch (err) {
    await markActionFailed(action.id, (err as Error).message).catch(() => {});
    return error((err as Error).message || 'Commit failed', 500);
  }
}
