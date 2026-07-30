/**
 * Entity-node timeline: the dated log of "moves" appended to a graph node's
 * attributes.timeline each time a signal about that entity is accepted (see
 * acceptAlertIntoKnowledge). Repeat signals ENRICH the entity's node instead of
 * spawning a new node per event — the graph gets richer, not longer.
 */

/** Where a timeline move came from. Optional — entries written before this
 *  field existed have no kind and render as plain moves. */
export type TimelineEntryKind =
  | 'watcher'       // an accepted watcher/ecosystem signal (the original writer)
  | 'founder_edit'  // the founder corrected the node in the detail panel
  | 'copilot'       // the co-pilot/agent enriched the node (chat, skills)
  | 'digest'        // a document upload created/enriched the node
  | 'apply'         // the founder approved the node into intelligence
  | 'created';      // the node's birth entry (which surface created it)

/** One dated move on an entity node. */
export interface TimelineEntry {
  date?: string;
  headline: string;
  source_url?: string;
  relevance?: number;
  alert_id?: string;
  kind?: TimelineEntryKind;
  /** For edits: which fields changed (e.g. ['name','summary'] or ['metrics']). */
  fields?: string[];
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
