import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { recordEvent, type EventType } from '@/lib/memory/events';
import { AuthError } from '@/lib/auth/require-user';
import { requireProjectAccess } from '@/lib/auth/require-project-access';
import { debitCredits, KNOWLEDGE_APPLY_CREDITS } from '@/lib/credits';
import type { ReviewedState } from '@/types/artifacts';
import type { EcosystemAlertState } from '@/types';

const KNOWLEDGE_STATES: ReadonlySet<ReviewedState> = new Set<ReviewedState>([
  'pending', 'applied', 'rejected',
]);
const ALERT_STATES: ReadonlySet<EcosystemAlertState> = new Set<EcosystemAlertState>([
  'pending', 'acknowledged', 'dismissed', 'promoted_to_action',
]);

// Exhaustive map: compiler errors if EcosystemAlertState grows without an entry here.
const ALERT_EVENT_MAP: Record<EcosystemAlertState, EventType> = {
  acknowledged: 'alert_acknowledged',
  dismissed: 'alert_dismissed',
  promoted_to_action: 'alert_promoted',
  pending: 'alert_reverted',
};

// Per-table UPDATE queries with correct timestamp columns.
const UPDATE_QUERIES: Record<string, string> = {
  memory_facts: 'UPDATE memory_facts SET reviewed_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  graph_nodes: 'UPDATE graph_nodes SET reviewed_state = ? WHERE id = ?',
  tabular_reviews: 'UPDATE tabular_reviews SET reviewed_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ecosystem_alerts: 'UPDATE ecosystem_alerts SET reviewed_state = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?',
};

// Knowledge pending→applied as an ATOMIC conditional flip (only matches a row
// that ISN'T already applied). Two concurrent double-fires can't both match, so
// exactly one debits — closing the read-prevState-then-update race that could
// double-charge on a rapid double-click (item 8 "credits scaled at random").
const APPLY_UPDATE_QUERIES: Record<string, string> = {
  memory_facts: "UPDATE memory_facts SET reviewed_state = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND reviewed_state != 'applied'",
  graph_nodes: "UPDATE graph_nodes SET reviewed_state = 'applied' WHERE id = ? AND reviewed_state != 'applied'",
  tabular_reviews: "UPDATE tabular_reviews SET reviewed_state = 'applied', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND reviewed_state != 'applied'",
};

/**
 * PATCH /api/projects/{projectId}/knowledge/{itemId}
 *
 * Transition an item's reviewed_state.
 *
 * For knowledge items (memory_facts, graph_nodes, tabular_reviews):
 *   state must be 'pending' | 'applied' | 'rejected'
 *
 * For ecosystem_alerts:
 *   state must be 'pending' | 'acknowledged' | 'dismissed' | 'promoted_to_action'
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; itemId: string }> },
) {
  const { projectId, itemId } = await params;
  // SECURITY: gate on project access (the prior `row.project_id !== projectId`
  // check was attacker-controllable on both sides; debits credits + mutates).
  let userId: string;
  try {
    ({ userId } = await requireProjectAccess(projectId));
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const body = await request.json().catch(() => null);
  const state = body?.state as string | undefined;
  if (!state) {
    return error('state is required', 400);
  }

  // Probe tables to find which one contains this item. Knowledge tables also
  // return the current reviewed_state so we can detect a pending→applied
  // transition and debit credits exactly once for it.
  const tables: Array<{
    table: string;
    type: string;
    isAlert: boolean;
    check: () => Promise<{ project_id: string; reviewed_state?: string } | undefined>;
  }> = [
    {
      table: 'memory_facts',
      type: 'fact',
      isAlert: false,
      check: () => get<{ project_id: string; reviewed_state: string }>(
        'SELECT project_id, reviewed_state FROM memory_facts WHERE id = ?', itemId,
      ),
    },
    {
      table: 'graph_nodes',
      type: 'graph_node',
      isAlert: false,
      check: () => get<{ project_id: string; reviewed_state: string }>(
        'SELECT project_id, reviewed_state FROM graph_nodes WHERE id = ?', itemId,
      ),
    },
    {
      table: 'tabular_reviews',
      type: 'tabular_review',
      isAlert: false,
      check: () => get<{ project_id: string; reviewed_state: string }>(
        'SELECT project_id, reviewed_state FROM tabular_reviews WHERE id = ?', itemId,
      ),
    },
    {
      table: 'ecosystem_alerts',
      type: 'ecosystem_alert',
      isAlert: true,
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM ecosystem_alerts WHERE id = ?', itemId,
      ),
    },
  ];

  for (const { table, type, isAlert, check } of tables) {
    const row = await check();
    if (!row) continue;

    // Verify the item belongs to this project
    if (row.project_id !== projectId) {
      return error('Item does not belong to this project', 403);
    }

    // Validate state against the correct state machine
    if (isAlert) {
      if (!ALERT_STATES.has(state as EcosystemAlertState)) {
        return error(
          'state must be "pending", "acknowledged", "dismissed", or "promoted_to_action" for alerts',
          400,
        );
      }
    } else {
      if (!KNOWLEDGE_STATES.has(state as ReviewedState)) {
        return error('state must be "applied", "rejected", or "pending"', 400);
      }
    }

    // Perform the state transition. For a knowledge pending→applied we use the
    // ATOMIC conditional flip and debit ONLY if it actually changed a row — so a
    // concurrent double-fire (count 0 on the loser) and a re-apply (already
    // applied) both charge nothing. All other transitions (reject / revert /
    // alert states) use the plain per-table update.
    let creditsDebited = 0;
    if (!isAlert && state === 'applied') {
      const res = await run(APPLY_UPDATE_QUERIES[table], itemId);
      const flipped = (res.count ?? 0) > 0;
      if (flipped) {
        // Server-side so the debit can't be skipped by the client. Non-fatal —
        // a failed debit must never block the apply that already landed.
        try {
          await debitCredits(projectId, KNOWLEDGE_APPLY_CREDITS, 'knowledge_apply');
          creditsDebited = KNOWLEDGE_APPLY_CREDITS;
        } catch (err) {
          console.warn('[knowledge PATCH] credit debit failed (non-fatal):', (err as Error).message);
        }
      }
    } else {
      await run(UPDATE_QUERIES[table], state, itemId);
    }

    // Record audit event
    const eventType: EventType = isAlert
      ? ALERT_EVENT_MAP[state as EcosystemAlertState]
      : state === 'applied' ? 'knowledge_applied'
        : state === 'rejected' ? 'knowledge_rejected'
        : 'knowledge_reverted';

    await recordEvent({
      userId,
      projectId,
      eventType,
      payload: { itemId, table: type, state },
    });

    return json({
      itemId,
      type,
      state: state as ReviewedState | EcosystemAlertState,
      credits_debited: creditsDebited,
    });
  }

  return error('Item not found', 404);
}
