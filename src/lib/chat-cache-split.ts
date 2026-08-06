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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DO NOT ENABLE. Measured 2026-08-05 — it passes the cost gate and BREAKS THE
 * PRODUCT.
 *
 *   cost      writes -71%, chat cost -57% ($0.156 -> $0.067/turn). The gate
 *             above is satisfied: reads and writes swap almost exactly.
 *   behaviour Validation Gate walkthrough, 3 runs each, same code otherwise:
 *                 OFF   8 · 8 · 8      ALWAYS 6 · FLAKY 4 · NEVER 1
 *                 ON    1 · 1 · 6      ALWAYS 1 · FLAKY 5 · NEVER 5
 *             regulatory_check, ip_analysis, data_availability and
 *             key_dependencies went from green in EVERY run to green in none.
 *
 * The eng-review gate was necessary and not sufficient: it prices the prompt and
 * never asks whether the product still works. Shipping on the cost number alone
 * would have cut the gate from 8/21 to ~1/21 for real founders while the
 * dashboard showed a 57% saving.
 *
 * Why it breaks, and what a shippable version looks like: the split moves the
 * WHOLE dynamic block onto the user turn, behind a fence that announces itself
 * as "reference data + steering". But that block is not all data — stageContext
 * carries the imperatives that make the gate deterministic ("THE FOUNDER PRESSED
 * THIS STEP — close THIS one", "CLOSE WITH: propose_validation(kind: …)"). A
 * directive demoted to reference data stops being obeyed.
 *
 * The fix is to split by KIND, not by position: the imperatives are static, so
 * they belong in the cached system prefix; only the volatile DATA (which checks
 * are open, memory, canvas) should ride the user turn. That keeps the cache win
 * and the instructions' authority. Not built.
 * ─────────────────────────────────────────────────────────────────────────────
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
