import { NextRequest } from 'next/server';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { run, get } from '@/lib/db';
import { recordFact } from '@/lib/memory/facts';
import { extractEntitiesFromNote } from '@/lib/note-entity-extract';
import { routeNoteToGraph } from '@/lib/note-graph-routing';
import { stageValidationProposal } from '@/lib/project-tools';

/**
 * POST /api/projects/{projectId}/notes
 *
 * Free-form founder note → straight into Knowledge (changelog 17/06 item 12:
 * "a small Notes section where the user jots news/notes and these update the
 * knowledge directly"). Stored as an APPLIED memory_fact with kind='note' so it
 * enters agent context immediately (no approval gate — it's the founder's own
 * input, not external evidence) and shows on the Knowledge page.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error('Body must be JSON', 400);
  }

  const text = typeof body.note === 'string' ? body.note.trim() : '';
  if (!text) return error('note is required', 400);
  if (text.length > 4000) return error('note too long (max 4000 chars)', 400);

  const id = await recordFact({
    userId: auth.session.userId,
    projectId,
    fact: text,
    kind: 'note',
    reviewedState: 'applied',
  });
  if (!id) return error('Failed to save note', 500);

  // #389 — a note naming entities stages a proposal card (inbox), so the note
  // reaches the graph through the founder's Apply instead of dying in the
  // Elenco tab. Awaited: serverless freezes un-awaited work, and losing the
  // extraction silently would recreate the exact complaint. Adds ~2-4s to
  // saving a LONG note only (short notes skip via NOTE_EXTRACT_MIN_CHARS);
  // non-fatal — a failed extraction never costs the founder their note.
  let staged = 0;
  let routed: { attached: string[]; fallback: boolean } = { attached: [], fallback: false };
  try {
    const entities = await extractEntitiesFromNote(text);
    // Changelog 28/08 item 3 — a note ABOUT an existing node lands on that
    // node's branch (notes + history), not just in the Elenco; a note naming
    // nothing lands in the applied Brainstorming bucket. Deterministic name
    // match, append-only, non-fatal. Runs before the proposal staging so a
    // note about a known competitor both annotates it AND (if extraction
    // found new entities) still stages the approval card.
    routed = await routeNoteToGraph(
      projectId,
      auth.session.userId,
      text,
      entities.competitors.map((c) => c.name),
    );
    // The note itself is the source on every item: an approval card whose
    // provenance reads "Founder note" + the sentence it came from is the
    // difference between evidence and an assertion.
    const noteSource = [{ type: 'user', title: 'Founder note', quote: text.slice(0, 280) }];
    const items = [
      // `competitor` is the one kind carrying a name — the executor writes a
      // profile row (and, on Apply, the graph entity that was #389's complaint).
      ...entities.competitors.map((c) => ({
        kind: 'competitor', name: c.name, value: c.summary || c.name, sources: noteSource,
      })),
      // Everything else is a {kind, field?, value} fact. `field` is passed
      // through untouched: for tech_fact it selects WHICH 1B check the item
      // closes, and dropping it here would send the fact to no check at all.
      ...entities.facts.map((f) => ({
        kind: f.kind, ...(f.field ? { field: f.field } : {}), value: f.value, sources: noteSource,
      })),
    ];
    if (items.length > 0) {
      const res = await stageValidationProposal(
        { projectId, userId: auth.session.userId },
        items as never,
        'note',
      );
      if (res.ok) {
        staged = res.itemCount;
        // The card MUST land somewhere the founder can act on it. During the
        // alpha, validation_proposal has NO inbox surface (action-lanes.ts:
        // the 'approval' lane renders only in chat) — the first version of
        // this route discarded res.artifactBlock, leaving an approvable card
        // in the DB that no screen showed: the exact "handoff gap" class this
        // codebase keeps re-finding (48h audit, cluster C). Persist it as an
        // assistant chat message (the brief-route pattern) so the founder
        // finds it in the co-pilot thread.
        const msgId = generateId('msg');
        // In-project surfaces follow project.locale — hardcoding either
        // language here would be the exact leak class the 48h audit flagged.
        const loc = await get<{ locale: string | null }>(
          'SELECT locale FROM projects WHERE id = ?', projectId).catch(() => null);
        const noteIntro = loc?.locale === 'it'
          ? 'Ho letto la tua nota — ci ho trovato queste entità. Approvale se vuoi che entrino nella tua knowledge:'
          : 'I read your note — it names these entities. Approve them if you want them in your knowledge:';
        const chatMsgArgs = [
          msgId, projectId, `${noteIntro}\n\n${res.artifactBlock}`, new Date().toISOString(), auth.session.userId,
        ] as const;
        try {
          await run(
            `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
             VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
            ...chatMsgArgs,
          );
        } catch (err) {
          console.warn('[notes] chat card persist failed, retrying once:', (err as Error).message);
          try {
            await run(
              `INSERT INTO chat_messages (id, project_id, step, role, content, "timestamp", user_id)
               VALUES (?, ?, 'chat', 'assistant', ?, ?, ?)`,
              ...chatMsgArgs,
            );
          } catch (retryErr) {
            // No other surface can ever show this card — validation_proposal
            // has no inbox path during the alpha (see the comment above) — so
            // losing this insert makes the pending_action a permanent, invisible
            // orphan. Loud on purpose; the note itself is already saved fine.
            console.error('[notes] chat card persist failed twice — validation_proposal orphaned:', {
              projectId, staged, error: (retryErr as Error).message,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[notes] entity staging failed (non-fatal):', (err as Error).message);
  }

  return json({ id, staged_entities: staged, attached_nodes: routed.attached, brainstorming: routed.fallback }, 201);
}
