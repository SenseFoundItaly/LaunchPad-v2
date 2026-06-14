import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import { debitCredits, KNOWLEDGE_APPLY_CREDITS } from '@/lib/credits';
import { recordEvent } from '@/lib/memory/events';

/**
 * POST /api/projects/{projectId}/knowledge/apply-batch   { item_ids: string[] }
 *
 * Applies N pending graph_nodes in ONE call with ONE combined credit debit —
 * powers the create-from-documents populating view, so all extracted entities
 * apply behind a single "Apply · N credits" button instead of N separate clicks
 * (and N debits) in Know.
 *
 * Credit accounting invariant: debits ONLY on a genuine pending→applied
 * transition (the SELECT-before-UPDATE `reviewed_state !== 'applied'` guard,
 * identical to the per-node PATCH /knowledge/[itemId]). So a node already
 * applied via any other path (per-node PATCH, inbox executor) is a free no-op
 * here — no double charge. The debit is computed from what ACTUALLY
 * transitioned, so it always matches reality even on partial dedup or a bad id.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId } = await params;

  let body: { item_ids?: unknown; skip_charge?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Body must be JSON', 400);
  }
  const itemIds = Array.isArray(body.item_ids)
    ? body.item_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
    : [];
  if (itemIds.length === 0) {
    return error('item_ids must be a non-empty array of node ids', 400);
  }
  // skip_charge=true → apply WITHOUT the per-entity debit. Used by the
  // Knowledge-page document popup, where the flat per-document audit fee was
  // already billed at upload (?audit_charge=1), so applying is free. Credits
  // are a soft UX skin over the dollar budget (the real cap is cap_llm_usd),
  // so this isn't a billing-bypass risk — just avoids double-charging.
  const skipCharge = body.skip_charge === true;

  let appliedCount = 0;
  for (const id of itemIds) {
    const row = await get<{ project_id: string; reviewed_state: string }>(
      'SELECT project_id, reviewed_state FROM graph_nodes WHERE id = ?',
      id,
    );
    if (!row) continue; // unknown id — skip, don't abort the batch
    if (row.project_id !== projectId) {
      return error('Item does not belong to this project', 403); // ownership — hard fail
    }
    if (row.reviewed_state === 'applied') continue; // already applied — no double charge
    await run("UPDATE graph_nodes SET reviewed_state = 'applied' WHERE id = ?", id);
    appliedCount++;
    try {
      await recordEvent({
        userId,
        projectId,
        eventType: 'knowledge_applied',
        payload: { itemId: id, table: 'graph_node', state: 'applied', batch: true },
      });
    } catch {
      /* event logging is non-fatal */
    }
  }

  // ONE combined debit, computed from what actually transitioned. Non-fatal:
  // the nodes are already applied; a failed debit shouldn't unwind them.
  // Skipped entirely when skip_charge=true (the audit fee already covered it).
  let creditsDebited = 0;
  if (appliedCount > 0 && !skipCharge) {
    try {
      await debitCredits(projectId, appliedCount * KNOWLEDGE_APPLY_CREDITS, 'knowledge_apply');
      creditsDebited = appliedCount * KNOWLEDGE_APPLY_CREDITS;
    } catch (e) {
      console.warn('[knowledge/apply-batch] debitCredits failed:', (e as Error).message);
    }
  }

  return json({ applied: appliedCount, credits_debited: creditsDebited });
}
