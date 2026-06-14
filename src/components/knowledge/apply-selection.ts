import type { ExtractedEntity } from './AddDocumentsDialog';

/**
 * initialSelection — decides which extracted entities start CHECKED in the
 * "what do you want to add to your knowledge" popup.
 *
 * As of the flat per-document audit pricing (2026-06-14) applying is FREE — the
 * founder already paid the per-document audit fee, so this is now a pure GRAPH-
 * CURATION decision, not a spend one. It shapes how noisy the graph starts:
 *
 *   • Pre-check EVERYTHING        → one-click confirm; fine since it's free, but
 *                                   may clutter the graph with weak entities.
 *   • Pre-check NOTHING           → deliberate opt-in, cleanest graph, most clicks.
 *   • Pre-check the HIGH-SIGNAL   → smart default: only entities that earn their
 *     ones                          place — e.g. ones that `validates` a spine
 *                                   substep, or named types (competitor, persona,
 *                                   market_segment) over generic ones (feature,
 *                                   metric). Founder trims/adds the rest.
 *
 * Only entities with a `node_id` are applicable (others were de-duped — already
 * in the graph). Return the set of node_ids to pre-select.
 *
 * TODO(founder decision): encode the curation policy you want. The baseline
 * below pre-checks every applicable entity so the popup is usable out of the
 * box — replace it with the strategy that fits how clean you want the graph.
 */
export function initialSelection(entities: ExtractedEntity[]): Set<string> {
  // --- baseline: select all applicable (replace with your policy) ---
  return new Set(
    entities
      .filter((e) => !!e.node_id)
      .map((e) => e.node_id!),
  );
}
