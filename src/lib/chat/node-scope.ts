/**
 * Node-scoped chat threads (#330, epic #324).
 *
 * A per-node thread is just the main chat pipeline addressed with a different
 * `step`. That works with ZERO schema change because `step` is already the
 * thread axis everywhere it matters:
 *   - `chat_messages.step` is a free-form VARCHAR (no CHECK constraint),
 *   - `useChat` keys its module store by `${projectId}::${step}`,
 *   - `GET /api/chat/history` filters by `step`,
 *   - `POST /api/chat` persists + logs usage under `step`.
 *
 * So `step = 'node:<nodeId>'` gives an isolated, server-persisted thread that
 * reuses streaming, credits, tools and the approval gate as-is.
 *
 * The ONE thing that does not fall out for free is the pi-agent session key,
 * which is deliberately per (user, project) so memory is shared across the
 * chat/research/simulation steps. A node side-thread must NOT bleed into the
 * founder's main conversation, so the route widens the key with the node step
 * (see `sessionSuffixForStep`).
 */

export const NODE_STEP_PREFIX = 'node:';

/** The chat `step` that addresses a given node's thread. */
export function nodeChatStep(nodeId: string): string {
  return `${NODE_STEP_PREFIX}${nodeId}`;
}

/**
 * The node id a step addresses, or null for the ordinary project-wide steps
 * ('chat', 'research', ...). Returns null for a bare/blank `node:` so a
 * malformed step can never widen into an unscoped node lookup.
 */
export function parseNodeStep(step: string | undefined | null): string | null {
  if (!step || !step.startsWith(NODE_STEP_PREFIX)) return null;
  const id = step.slice(NODE_STEP_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}

/**
 * Suffix appended to the pi-agent session key. Empty for project-wide steps
 * (byte-identical to the previous key, so existing sessions keep their memory);
 * node steps get their own session so a side-thread about one entity does not
 * pollute — or get polluted by — the main chat.
 */
export function sessionSuffixForStep(step: string): string {
  const nodeId = parseNodeStep(step);
  return nodeId ? `-node-${nodeId}` : '';
}
