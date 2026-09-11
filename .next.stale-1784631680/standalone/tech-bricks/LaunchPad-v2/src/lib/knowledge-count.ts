import { get } from '@/lib/db';

/**
 * Single source of truth for the "knowledge" count shown on the founder
 * surfaces — the NavRail "Knowledge" badge AND the Canvas "Knowledge — N
 * elementi" row. Both used to derive this independently with divergent filters
 * and caps, so the sidebar and the canvas disagreed (e.g. 11 vs 9). This is the
 * ONE definition both now consume.
 *
 * APPLIED knowledge only:
 *   • graph_nodes — reviewed_state='applied', excluding the synthetic
 *     `your_startup` root (that node represents the project itself, not a piece
 *     of knowledge).
 *   • memory_facts — reviewed_state='applied', excluding process telemetry
 *     (approval_inbox source + "Agent proposed workflow…" facts), matching the
 *     filter the intelligence panel applies to what the founder reads as "what
 *     we know". `IS DISTINCT FROM` is NULL-safe so null-source facts are kept,
 *     exactly like the JS filter `f.source_type !== 'approval_inbox'`.
 *
 * Pending PROPOSALS are deliberately excluded — they're surfaced apart as
 * "proposed" and reviewed on /knowledge; they're not knowledge the founder has.
 * Counts are TRUE totals (no LIMIT) so every surface agrees regardless of size.
 */
export async function countAppliedKnowledge(
  projectId: string,
  ownerUserId: string | null,
): Promise<{ nodes: number; facts: number; total: number }> {
  const nodeRow = await get<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM graph_nodes
     WHERE project_id = ? AND reviewed_state = 'applied'
       AND node_type IS DISTINCT FROM 'your_startup'`,
    projectId,
  );
  const nodes = nodeRow?.cnt ?? 0;

  let facts = 0;
  if (ownerUserId) {
    const factRow = await get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM memory_facts
       WHERE user_id = ? AND project_id = ? AND reviewed_state = 'applied'
         AND source_type IS DISTINCT FROM 'approval_inbox'
         AND fact NOT LIKE 'Agent proposed workflow%'`,
      ownerUserId,
      projectId,
    );
    facts = factRow?.cnt ?? 0;
  }

  return { nodes, facts, total: nodes + facts };
}
