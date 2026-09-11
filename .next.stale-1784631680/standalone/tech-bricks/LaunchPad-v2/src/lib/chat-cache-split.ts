/**
 * Lever 1 (copilot-cost): cut chat cost by keeping the system prompt's STATIC
 * prefix (SOUL + AGENTS + ARTIFACT_INSTRUCTIONS, ~17k tok, byte-identical every
 * turn) stable, so Anthropic prompt-caching READS it instead of RE-WRITING it
 * every turn. Today the dynamic per-turn context is concatenated into the system
 * string, so any change (canvas/stage/memory/nudge) busts the cached prefix and
 * forces a ~17k-token cache WRITE — measured as ~68% of chat cost.
 *
 * Fix: build the system prompt WITHOUT the dynamic context, and move that context
 * + the recency steering into the user turn via buildSplitUserTurn(). The model
 * receives the SAME bytes, only repositioned (system-tail → user-turn prefix),
 * with the recency steering LAST (just before the founder's message) so the
 * locale/violation/prereq nudges keep their read-recency.
 *
 * Flag-gated (default OFF) so it ships dark + A/B-able until a live cacheRead
 * trace confirms cache_read RISES and cache_creation FALLS (the eng-review gate).
 */
export const CACHE_PREFIX_SPLIT = process.env.CACHE_PREFIX_SPLIT === '1';

/**
 * Fence the per-turn dynamic context + steering ahead of the founder's message,
 * so the system prompt can stay byte-stable. Steering goes LAST (max recency).
 * Empty context → the founder's message passes through unchanged. Pure +
 * deterministic so content-preservation + ordering are unit-testable.
 */
export function buildSplitUserTurn(
  dynamicContext: string,
  trailingSteer: string,
  lastMessage: string,
): string {
  const ctx = [dynamicContext.trim(), trailingSteer.trim()].filter(Boolean).join('\n\n');
  if (!ctx) return lastMessage;
  return (
    `[PROJECT CONTEXT FOR THIS TURN — reference data + steering for you; ` +
    `the founder's actual message follows the END marker]\n${ctx}\n[END CONTEXT]\n\n${lastMessage}`
  );
}
