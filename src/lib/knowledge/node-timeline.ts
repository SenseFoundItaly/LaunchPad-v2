/**
 * appendNodeTimeline — the ONE shared writer for a node's evolution history
 * (epic #324). Every mutation of a graph node (founder edit, apply, co-pilot
 * enrichment, digest) appends a dated move to `attributes.timeline`, which the
 * NodeDetailPanel ("Movimenti recenti") and the Knowledge page's Cronologia
 * feed already render — no new read surface.
 *
 * Invariants (mirroring the proven watcher-upsert branch in
 * action-executors.ts and the atomic entry-delete in knowledge/[itemId]):
 *  - ATOMIC append: the cap+merge happens entirely in SQL (no JS
 *    read-modify-write), so a concurrent enrich can't clobber this entry and
 *    vice versa.
 *  - RAW jsonb bind: the entry array is bound as-is; postgres.js serializes to
 *    JSONB exactly once. Pre-stringifying double-encodes (the codebase's
 *    recurring footgun) and the timeline reads back as a string scalar.
 *  - Newest-20 cap, re-sorted back to chronological (append) order.
 *  - NON-THROWING: a failed history write must never fail the mutation it
 *    documents.
 *
 * The watcher path in acceptAlertIntoKnowledge keeps its own single-statement
 * upsert (INSERT + conflict-append in one statement is what closes its
 * duplicate-node race) — it tags entries `kind: 'watcher'` and stays the one
 * writer NOT routed through here, by design.
 */

import { run } from '@/lib/db';
import { resolveLocale } from '@/lib/i18n/resolve-locale';
import type { Locale } from '@/lib/i18n/locales';
import type { TimelineEntry, TimelineEntryKind } from '@/lib/timeline';

/**
 * Fail-open locale for history headlines: a locale-lookup failure must never
 * abort the mutation the history documents (surfaced by the investor-pipeline
 * tests — a throwing resolver inside a writer's try block killed the upsert).
 */
export async function historyLocale(userId: string | null, projectId: string | null): Promise<Locale> {
  try {
    return await resolveLocale(userId, projectId);
  } catch {
    return 'en';
  }
}

/** Build a timeline entry stamped now. */
export function timelineEntryNow(
  kind: TimelineEntryKind,
  headline: string,
  extra?: Partial<Pick<TimelineEntry, 'fields' | 'source_url'>>,
): TimelineEntry {
  return {
    date: new Date().toISOString(),
    headline,
    kind,
    ...(extra?.fields && extra.fields.length > 0 ? { fields: extra.fields } : {}),
    ...(extra?.source_url ? { source_url: extra.source_url } : {}),
  };
}

/**
 * Append one move to a node's timeline. Scoped to (id, project_id) so a
 * cross-project id can't write history onto another project's node.
 */
export async function appendNodeTimeline(
  projectId: string,
  nodeId: string,
  entry: TimelineEntry,
): Promise<void> {
  try {
    await run(
      `UPDATE graph_nodes
          SET attributes = jsonb_set(
            COALESCE(attributes, '{}'::jsonb),
            '{timeline}',
            (
              SELECT COALESCE(jsonb_agg(elem ORDER BY ord), '[]'::jsonb)
              FROM (
                SELECT elem, ord
                FROM jsonb_array_elements(
                  COALESCE(attributes -> 'timeline', '[]'::jsonb) || ?::jsonb
                ) WITH ORDINALITY AS t(elem, ord)
                ORDER BY ord DESC
                LIMIT 20
              ) recent
            )
          )
        WHERE id = ? AND project_id = ?`,
      [entry], // RAW array bind — single-encode into jsonb
      nodeId,
      projectId,
    );
  } catch (err) {
    console.warn('[node-timeline] append failed (non-fatal):', (err as Error).message);
  }
}
