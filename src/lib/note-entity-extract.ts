/**
 * Note → entity extraction (#389, changelog 4/08).
 *
 * The founder's complaint: "le note vengono memorizzate nella tab Elenco ma
 * senza essere integrate da qualche parte. Se si perdono all'interno
 * dell'elenco non sono molto utili." Notes already reach the spine as applied
 * memory_facts (the keyword checks count them); what never happened is the
 * GRAPH — a note naming a competitor left no entity anywhere.
 *
 * Design (decision 2026-08-07, Mike, per the recommendation on #389): entities
 * are STAGED AS A PROPOSAL, never written directly. A note is founder input,
 * but "the graph says X is a competitor" is a different claim than "the founder
 * wrote a note mentioning X" — and a direct write would bypass the validation
 * gate ("nothing turns green without the founder's yes"). So the extractor
 * feeds the EXISTING chain: RawValidationItem[] → stageValidationProposal →
 * inbox card → founder Apply → executor writes competitor profiles / facts.
 * Zero new write paths — the four-hand-kept-copies lesson.
 *
 * v1 extracts the two kinds with the highest evidence value and a fully wired
 * executor: competitors (→ profiles + graph via the founder's Apply) and
 * potential partners (→ the partners_identified keyword family).
 *
 * One cheap-tier model call per note, non-fatal throughout: a failed
 * extraction costs the graph a suggestion, never the founder their note.
 */

import { runAgent } from '@/lib/pi-agent';

export interface ExtractedEntities {
  competitors: Array<{ name: string; summary: string }>;
  partners: Array<{ name: string; why: string }>;
}

/** Notes shorter than this are greetings/reminders — nothing to extract. */
export const NOTE_EXTRACT_MIN_CHARS = 30;

export function buildNoteExtractionPrompt(note: string): string {
  return [
    'From the founder note below, extract ONLY explicitly named entities:',
    '- competitors: companies/products the note treats as competing or comparable',
    '- partners: organizations the note treats as potential partners, resellers or distributors',
    '',
    'Rules: only entities NAMED in the note (never invent or infer unnamed ones);',
    'keep summaries in the language of the note; at most 5 of each; when the note',
    'names none, return empty arrays.',
    '',
    `NOTE: ${note}`,
    '',
    'Answer with strict JSON only:',
    '{"competitors":[{"name":"...","summary":"what the note says about them, one sentence"}],',
    ' "partners":[{"name":"...","why":"why the note sees them as a partner, one sentence"}]}',
  ].join('\n');
}

/** Defensive parse — malformed model output yields EMPTY, never a throw and
 *  never a fabricated entity. Same discipline as parseIcpJudgeReply. */
export function parseEntityExtraction(text: string): ExtractedEntities {
  const empty: ExtractedEntities = { competitors: [], partners: [] };
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return empty;
    const o = JSON.parse(m[0]) as { competitors?: unknown; partners?: unknown };
    const pick = <T>(arr: unknown, map: (x: Record<string, unknown>) => T | null): T[] =>
      Array.isArray(arr)
        ? arr.slice(0, 5).map((x) => (x && typeof x === 'object' ? map(x as Record<string, unknown>) : null))
            .filter((x): x is T => x != null)
        : [];
    return {
      competitors: pick(o.competitors, (x) =>
        typeof x.name === 'string' && x.name.trim()
          ? { name: x.name.trim().slice(0, 120), summary: String(x.summary ?? '').trim().slice(0, 300) }
          : null),
      partners: pick(o.partners, (x) =>
        typeof x.name === 'string' && x.name.trim()
          ? { name: x.name.trim().slice(0, 120), why: String(x.why ?? '').trim().slice(0, 300) }
          : null),
    };
  } catch {
    return empty;
  }
}

/** Run the extraction. Returns empty on any failure — the caller stages a
 *  proposal only when something was actually found. */
export async function extractEntitiesFromNote(note: string): Promise<ExtractedEntities> {
  if (note.trim().length < NOTE_EXTRACT_MIN_CHARS) return { competitors: [], partners: [] };
  try {
    const res = await runAgent(buildNoteExtractionPrompt(note), { task: 'update-generate', traceName: 'note-entity-extract' });
    return parseEntityExtraction(String(res?.text ?? ''));
  } catch (err) {
    console.warn('[note-extract] failed (non-fatal):', (err as Error).message);
    return { competitors: [], partners: [] };
  }
}
