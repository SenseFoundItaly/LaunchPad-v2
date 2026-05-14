import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { recordEvent, type EventType } from '@/lib/memory/events';
import { requireUser, AuthError } from '@/lib/auth/require-user';
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
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return error(e.message, e.status);
    throw e;
  }

  const { projectId, itemId } = await params;

  const body = await request.json().catch(() => null);
  const state = body?.state as string | undefined;
  if (!state) {
    return error('state is required', 400);
  }

  // Probe tables to find which one contains this item
  const tables: Array<{
    table: string;
    type: string;
    isAlert: boolean;
    check: () => Promise<{ project_id: string } | undefined>;
  }> = [
    {
      table: 'memory_facts',
      type: 'fact',
      isAlert: false,
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM memory_facts WHERE id = ?', itemId,
      ),
    },
    {
      table: 'graph_nodes',
      type: 'graph_node',
      isAlert: false,
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM graph_nodes WHERE id = ?', itemId,
      ),
    },
    {
      table: 'tabular_reviews',
      type: 'tabular_review',
      isAlert: false,
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM tabular_reviews WHERE id = ?', itemId,
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

    // Perform the state transition (per-table query handles correct timestamp columns)
    await run(UPDATE_QUERIES[table], state, itemId);

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
    });
  }

  return error('Item not found', 404);
}
