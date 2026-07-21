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

  // Content edit (graph detail drawer): the founder can correct a node's name
  // or summary in place. Independent of the reviewed_state machine and free —
  // it's an edit, not an apply. Scoped to graph_nodes (the only thing the graph
  // drawer shows) + the URL project.
  const editName = typeof body?.name === 'string' ? body.name.trim() : undefined;
  const editSummary = typeof body?.summary === 'string' ? body.summary.trim() : undefined;
  // Timeline curation: remove the dated move whose alert_id matches (the founder
  // pruning a wrong/misattributed auto-added entry from a node's dossier).
  const removeTimelineAlertId = typeof body?.remove_timeline_alert_id === 'string'
    ? body.remove_timeline_alert_id
    : undefined;
  // Metric edit (MetricGridCard click-to-edit): the founder corrected metric
  // values on a persisted metric-grid node. Replaces the node's attributes +
  // summary with the edited set, so refresh re-renders the corrections and a
  // later Apply commits them. Same edit-not-apply semantics as name/summary.
  const editMetrics: Array<{ label: string; value: string; change?: string }> | undefined =
    Array.isArray(body?.metrics)
      ? (body.metrics as unknown[])
          .filter((m): m is { label: string; value: string; change?: string } => {
            const x = m as Record<string, unknown>;
            return !!x && typeof x.label === 'string' && x.label.trim().length > 0 && typeof x.value === 'string';
          })
          .slice(0, 24)
          .map((m) => ({
            label: m.label.trim().slice(0, 120),
            value: m.value.trim().slice(0, 120),
            ...(typeof m.change === 'string' && m.change.trim() ? { change: m.change.trim().slice(0, 40) } : {}),
          }))
      : undefined;
  const hasContentEdit = editName !== undefined || editSummary !== undefined
    || removeTimelineAlertId !== undefined || (editMetrics !== undefined && editMetrics.length > 0);

  if (!state && !hasContentEdit) {
    return error('state or content (name/summary/metrics/remove_timeline_alert_id) is required', 400);
  }

  if (hasContentEdit) {
    if (editName !== undefined && editName.length === 0) {
      return error('name cannot be empty', 400);
    }
    const node = await get<{ project_id: string }>(
      'SELECT project_id FROM graph_nodes WHERE id = ?', itemId,
    );
    if (!node) return error('Node not found', 404);
    if (node.project_id !== projectId) {
      return error('Item does not belong to this project', 403);
    }
    // COALESCE keeps the existing value for any field the founder didn't send.
    if (editName !== undefined || editSummary !== undefined) {
      await run(
        'UPDATE graph_nodes SET name = COALESCE(?, name), summary = COALESCE(?, summary) WHERE id = ?',
        editName ?? null,
        editSummary ?? null,
        itemId,
      );
    }
    if (editMetrics !== undefined && editMetrics.length > 0) {
      // Mirror persistMetricGrid's shapes: attributes = label → {value, change},
      // summary = the joined "label: value (change)" line. Bind the RAW object —
      // attributes is JSONB and postgres.js single-encodes (double-encode class).
      const attrs = editMetrics.reduce<Record<string, { value: string; change?: string }>>((acc, m) => {
        acc[m.label] = { value: m.value, ...(m.change ? { change: m.change } : {}) };
        return acc;
      }, {});
      const summary = editMetrics.map((m) => `${m.label}: ${m.value}${m.change ? ` (${m.change})` : ''}`).join(' · ');
      await run(
        'UPDATE graph_nodes SET attributes = ?, summary = ? WHERE id = ?',
        attrs,
        summary,
        itemId,
      );
      // Market-themed grids also wrote research.market_size at persist time —
      // carry the correction there too, preserving the founder-approval stamp
      // keys exactly like persistMetricGrid's full-replace does.
      const typed = await get<{ node_type: string }>(
        'SELECT node_type FROM graph_nodes WHERE id = ?', itemId,
      );
      if (typed?.node_type === 'research_metric') {
        await run(
          `UPDATE research
              SET market_size = ?::jsonb || CASE WHEN jsonb_typeof(market_size) = 'object'
                    THEN jsonb_strip_nulls(jsonb_build_object(
                         'approved', market_size->'approved',
                         'approved_at', market_size->'approved_at',
                         'approved_value', market_size->'approved_value',
                         '_title', market_size->'_title'))
                    ELSE '{}'::jsonb END,
                  researched_at = CURRENT_TIMESTAMP
            WHERE project_id = ?`,
          attrs,
          projectId,
        );
      }
    }
    if (removeTimelineAlertId !== undefined) {
      // Atomic rebuild: filter the matching alert_id out of attributes.timeline.
      // No read-modify-write, so it can't clobber a concurrent enrich append.
      await run(
        `UPDATE graph_nodes
            SET attributes = jsonb_set(
              COALESCE(attributes, '{}'::jsonb), '{timeline}',
              COALESCE((
                SELECT jsonb_agg(elem)
                FROM jsonb_array_elements(COALESCE(attributes -> 'timeline', '[]'::jsonb)) elem
                WHERE elem ->> 'alert_id' IS DISTINCT FROM ?
              ), '[]'::jsonb))
          WHERE id = ?`,
        removeTimelineAlertId,
        itemId,
      );
    }
    // Content edit is terminal unless a state change was ALSO requested (the UI
    // never combines them, but be safe and fall through when state is present).
    if (!state) {
      return json({ id: itemId, edited: true });
    }
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
