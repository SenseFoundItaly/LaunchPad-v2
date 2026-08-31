/**
 * Note → graph-branch routing (changelog 28/08 item 3).
 *
 * Luca's spec, verbatim shape: "durante una call mi annoto velocemente un
 * competitor che mi viene nominato. Il note taker cattura il commento e lo
 * struttura all'interno del ramo adatto del graph. In mancanza di un nodo
 * adatto, finirà nel nodo 'Brainstorming'."
 *
 * Before this, a note became an applied memory_fact (Elenco row) and — via
 * entity extraction — possibly a NEW pending competitor card, but a note that
 * talked ABOUT an existing node never reached that node's branch. This module
 * closes that: deterministic name matching (no LLM — the note either names a
 * node or it doesn't), append-only writes.
 *
 * Invariants respected:
 *   - attributes are NEVER wholesale-replaced (jsonb_set-preserve — wholesale
 *     `attributes = ?` destroys attributes.timeline, node-memory epic ⚠️).
 *   - The founder's own note is applied input, not external evidence: the
 *     Brainstorming bucket is created applied, no approval gate (same rule as
 *     the note fact itself). It's a container for the founder's own jottings —
 *     a pending bucket would be a card nobody can meaningfully approve.
 *   - Non-fatal everywhere: a failed routing never costs the founder the note
 *     (the memory_fact write happens before this runs).
 */

import { query, run, get } from '@/lib/db';
import { appendNodeTimeline, timelineEntryNow, historyLocale } from '@/lib/knowledge/node-timeline';
import { translate } from '@/lib/i18n/messages';

/** Max nodes one note attaches to — a note that name-drops half the graph is
 *  a brain-dump, not a targeted annotation; the fact row already holds it all. */
const MAX_ATTACH = 3;

/** Node-name tokens shorter than this match too promiscuously ("AI", "AB"). */
const MIN_NAME_LEN = 3;

interface NoteRouteResult {
  /** Names of the nodes the note was attached to ([] when none matched). */
  attached: string[];
  /** True when the note landed in the Brainstorming bucket instead. */
  fallback: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Attach a founder note to the graph node(s) it names, or to the applied
 * "Brainstorming" bucket when it names none. `entityNames` are the names the
 * note's entity extraction already found (matched exactly); the note TEXT is
 * also scanned for existing node names, so "Greenio ha alzato i prezzi"
 * reaches the Greenio node even when extraction stages nothing new.
 */
export async function routeNoteToGraph(
  projectId: string,
  userId: string | null,
  noteText: string,
  entityNames: string[] = [],
): Promise<NoteRouteResult> {
  const none: NoteRouteResult = { attached: [], fallback: false };
  try {
    const nodes = await query<{ id: string; name: string }>(
      `SELECT id, name FROM graph_nodes WHERE project_id = ?`,
      projectId,
    );
    const wanted = new Set(entityNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
    const matched = nodes
      .filter((n) => {
        const name = n.name.trim();
        if (name.length < MIN_NAME_LEN) return false;
        if (wanted.has(name.toLowerCase())) return true;
        // Whole-word-ish match of the node name inside the note text.
        return new RegExp(`(^|\\W)${esc(name)}(\\W|$)`, 'i').test(noteText);
      })
      .slice(0, MAX_ATTACH);

    const locale = await historyLocale(userId, projectId);
    const headline = translate(locale, 'node-history.note-attached', {
      note: noteText.length > 140 ? `${noteText.slice(0, 140)}…` : noteText,
    });
    const noteEntry = { text: noteText.slice(0, 1000), at: new Date().toISOString(), source: 'note' };

    const attachTo = async (nodeId: string) => {
      // Append-only: notes array preserved, everything else in attributes
      // untouched (timeline goes through its own preserve-append helper).
      await run(
        `UPDATE graph_nodes
            SET attributes = jsonb_set(
              COALESCE(attributes, '{}'::jsonb),
              '{notes}',
              COALESCE(attributes->'notes', '[]'::jsonb) || jsonb_build_array(?::jsonb))
          WHERE id = ? AND project_id = ?`,
        noteEntry,
        nodeId,
        projectId,
      );
      await appendNodeTimeline(projectId, nodeId, timelineEntryNow('founder_edit', headline));
    };

    if (matched.length > 0) {
      for (const n of matched) await attachTo(n.id);
      return { attached: matched.map((n) => n.name), fallback: false };
    }

    // No suitable branch — the Brainstorming bucket (applied: the founder's
    // own jottings need no approval; a pending bucket would be unapprovable).
    let bucket = await get<{ id: string }>(
      `SELECT id FROM graph_nodes WHERE project_id = ? AND node_type = 'brainstorming' LIMIT 1`,
      projectId,
    );
    if (!bucket?.id) {
      const id = `node_${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, '').slice(0, 12)}`;
      await run(
        `INSERT INTO graph_nodes (id, project_id, name, node_type, summary, attributes, reviewed_state)
         VALUES (?, ?, 'Brainstorming', 'brainstorming', ?, ?, 'applied')`,
        id,
        projectId,
        translate(locale, 'node-history.brainstorming-summary'),
        { timeline: [timelineEntryNow('created', translate(locale, 'node-history.brainstorming-created'))] },
      );
      bucket = { id };
    }
    await attachTo(bucket.id);
    return { attached: [], fallback: true };
  } catch (err) {
    console.warn('[note-graph-routing] routing failed (non-fatal):', (err as Error).message);
    return none;
  }
}
