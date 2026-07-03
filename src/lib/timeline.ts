/**
 * Entity-node timeline: the dated log of "moves" appended to a graph node's
 * attributes.timeline each time a signal about that entity is accepted (see
 * acceptAlertIntoKnowledge). Repeat signals ENRICH the entity's node instead of
 * spawning a new node per event — the graph gets richer, not longer.
 */

/** One dated move on an entity node. */
export interface TimelineEntry {
  date?: string;
  headline: string;
  source_url?: string;
  relevance?: number;
  alert_id?: string;
}

/**
 * Parse attributes.timeline defensively. `attributes` is JSONB, but legacy rows
 * in this codebase were persisted DOUBLE-ENCODED (a JSON.stringify into the
 * column stored a jsonb STRING scalar), so postgres.js can read it back as a
 * string. Handle both shapes, and drop any element that isn't a well-formed
 * entry (must be an object with a string headline). Returns entries in STORED
 * order (oldest first); callers reverse for newest-first display.
 */
export function coerceTimeline(raw: unknown): TimelineEntry[] {
  let val = raw;
  if (typeof val === 'string') {
    try {
      val = JSON.parse(val);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(val)) return [];
  return val.filter(
    (e): e is TimelineEntry =>
      !!e && typeof e === 'object' && typeof (e as { headline?: unknown }).headline === 'string',
  );
}
