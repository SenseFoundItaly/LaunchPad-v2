import { NextRequest } from 'next/server';
import { json, error } from '@/lib/api-helpers';
import { get, run } from '@/lib/db';
import { recordEvent } from '@/lib/memory/events';
import { requireUser, AuthError } from '@/lib/auth/require-user';
import type { ReviewedState } from '@/types/artifacts';

/**
 * PATCH /api/projects/{projectId}/knowledge/{itemId}
 *
 * Transition a knowledge item's reviewed_state to 'approved' or 'rejected'.
 * The itemId can be a memory_facts id, graph_nodes id, or tabular_reviews id.
 * The endpoint probes all three tables to find the matching row.
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
  if (state !== 'approved' && state !== 'rejected') {
    return error('state must be "approved" or "rejected"', 400);
  }

  // Probe tables to find which one contains this item
  const tables: Array<{
    table: string;
    type: string;
    projectColumn: string;
    check: () => Promise<{ project_id: string } | undefined>;
  }> = [
    {
      table: 'memory_facts',
      type: 'fact',
      projectColumn: 'project_id',
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM memory_facts WHERE id = ?', itemId,
      ),
    },
    {
      table: 'graph_nodes',
      type: 'graph_node',
      projectColumn: 'project_id',
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM graph_nodes WHERE id = ?', itemId,
      ),
    },
    {
      table: 'tabular_reviews',
      type: 'tabular_review',
      projectColumn: 'project_id',
      check: () => get<{ project_id: string }>(
        'SELECT project_id FROM tabular_reviews WHERE id = ?', itemId,
      ),
    },
  ];

  for (const { table, type, check } of tables) {
    const row = await check();
    if (!row) continue;

    // Verify the item belongs to this project
    if (row.project_id !== projectId) {
      return error('Item does not belong to this project', 403);
    }

    // Perform the state transition
    if (table === 'memory_facts') {
      await run(
        'UPDATE memory_facts SET reviewed_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        state, itemId,
      );
    } else {
      await run(
        `UPDATE ${table} SET reviewed_state = ? WHERE id = ?`,
        state, itemId,
      );
    }

    // Record audit event
    await recordEvent({
      userId,
      projectId,
      eventType: `knowledge_${state}`,
      payload: { itemId, table: type, state },
    });

    return json({ itemId, type, state: state as ReviewedState });
  }

  return error('Item not found', 404);
}
