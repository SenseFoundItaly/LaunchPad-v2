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
 * ── v2 (2026-08-14): the other 12 kinds ────────────────────────────────────
 * v1 extracted competitors and partners "because they have a fully wired
 * executor". That reason had stopped being a discriminator: `validation-targets`
 * maps **22** kinds onto gate checks, and ONE executor branch applies 13 fact
 * kinds identically (prefix + memory_fact). So the machinery a note needed was
 * already built and tested — the prompt simply never asked for anything else,
 * and a founder's note about a regulation or a cost landed nowhere.
 *
 * The shape changed with it: a generic `facts: [{kind, field?, value}]` list
 * rather than one bespoke array per kind, which is what let v1 ossify at two.
 * The parser filters against an ALLOWLIST — an invented kind is dropped, never
 * forwarded, because an unknown kind downstream is an item that stages and can
 * never be applied. Competitors keep their own array: they alone carry a `name`
 * the executor needs for the profile row.
 *
 * One cheap-tier model call per note, non-fatal throughout: a failed
 * extraction costs the graph a suggestion, never the founder their note.
 */

import { runAgent } from '@/lib/pi-agent';

/**
 * The kinds a founder plausibly writes in a note, each with a live write path
 * (keyword family → item kind → source → executor Apply prefix).
 *
 * Deliberately NOT the full 22: `canvas_field` is the co-pilot's structured
 * commit and must stay a deliberate act, `interview` implies a conversation
 * that happened, `pricing`/`metric`/`financial_fact`/`brand_fact` belong to
 * post-validation surfaces. A note is evidence in passing, not a commit.
 *
 * `trend_fact` and `buyer_persona_fact` are excluded for a different reason,
 * and the test below is what found it: their checks (`trends_assessed`,
 * `buyer_persona_defined`) were REMOVED from 1A on 2026-08-04 when the
 * founder's list landed. The kinds still apply as memory_facts, so staging
 * them would cost the founder an approval click that moves no substep — and
 * the note's own text is already an applied memory_fact in Knowledge, so
 * nothing is lost by leaving them out. Put them back here the day a check
 * reads them again.
 */
export const NOTE_FACT_KINDS = [
  'partner_fact', 'gtm_fact', 'jtbd_fact', 'differentiation_fact',
  'cogs_opex_fact', 'revenue_stream_fact',
  'ip_fact', 'data_fact', 'validation_strategy_fact', 'market_size_fact', 'tech_fact',
] as const;
export type NoteFactKind = (typeof NOTE_FACT_KINDS)[number];

/** `tech_fact` is the one kind whose check is selected by a discriminator, so
 *  the model must say WHICH 1B question it answers. Mirrors TECH_1B_SOURCES;
 *  an unrecognised field drops the fact rather than guessing a check. */
export const NOTE_TECH_FIELDS = ['feasibility', 'dependencies', 'regulatory', 'risk'] as const;

export interface ExtractedFact {
  kind: NoteFactKind;
  /** Only for `tech_fact`. */
  field?: (typeof NOTE_TECH_FIELDS)[number];
  value: string;
}

export interface ExtractedEntities {
  competitors: Array<{ name: string; summary: string }>;
  facts: ExtractedFact[];
}

/** Notes shorter than this are greetings/reminders — nothing to extract. */
export const NOTE_EXTRACT_MIN_CHARS = 30;

export function buildNoteExtractionPrompt(note: string): string {
  return [
    'From the founder note below, extract ONLY what the note explicitly states.',
    '',
    'competitors: companies/products the note treats as competing or comparable.',
    '',
    'facts: one entry per distinct statement, using EXACTLY one of these kinds:',
    '- partner_fact — an organization the note treats as a potential partner, reseller or distributor',
    '- market_size_fact — a market size, volume or spend figure',
    '- gtm_fact — a go-to-market opening, channel opportunity or friction',
    '- jtbd_fact — a job the customer is trying to get done',
    '- differentiation_fact — why this offer differs from the alternatives',
    '- cogs_opex_fact — a cost: what it is and whether it is fixed or variable',
    '- revenue_stream_fact — where money comes in',
    '- ip_fact — patents, trademarks, licences, proprietary assets',
    '- data_fact — data the venture has or needs access to',
    '- validation_strategy_fact — how the founder plans to test something',
    '- tech_fact — a technical statement; ALSO set "field" to one of:',
    '    feasibility (can it be built), dependencies (what it relies on),',
    '    regulatory (rules/compliance it must satisfy), risk (what could fail)',
    '',
    'Rules: only what is IN the note (never invent, never infer an unnamed entity);',
    'keep the wording in the language of the note; one sentence per fact; at most 5',
    'competitors and 8 facts; if the note states none, return empty arrays.',
    '',
    `NOTE: ${note}`,
    '',
    'Answer with strict JSON only:',
    '{"competitors":[{"name":"...","summary":"what the note says about them, one sentence"}],',
    ' "facts":[{"kind":"cogs_opex_fact","value":"one sentence, as the note puts it"},',
    '           {"kind":"tech_fact","field":"regulatory","value":"..."}]}',
  ].join('\n');
}

/** Defensive parse — malformed model output yields EMPTY, never a throw and
 *  never a fabricated entity. Same discipline as parseIcpJudgeReply. */
export function parseEntityExtraction(text: string): ExtractedEntities {
  const empty: ExtractedEntities = { competitors: [], facts: [] };
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return empty;
    const o = JSON.parse(m[0]) as { competitors?: unknown; facts?: unknown };

    const competitors = Array.isArray(o.competitors)
      ? o.competitors.slice(0, 5)
          .map((x) => (x && typeof x === 'object' ? x as Record<string, unknown> : null))
          .filter((x): x is Record<string, unknown> => !!x && typeof x.name === 'string' && !!String(x.name).trim())
          .map((x) => ({
            name: String(x.name).trim().slice(0, 120),
            summary: String(x.summary ?? '').trim().slice(0, 300),
          }))
      : [];

    // Allowlist, not trust: a kind the model invents has no source mapping, so
    // it would stage an item the executor can never apply — a silent orphan of
    // exactly the kind this codebase keeps digging out.
    const allowed = new Set<string>(NOTE_FACT_KINDS);
    const techFields = new Set<string>(NOTE_TECH_FIELDS);
    const facts = Array.isArray(o.facts)
      ? o.facts.slice(0, 8)
          .map((x) => (x && typeof x === 'object' ? x as Record<string, unknown> : null))
          .map((x): ExtractedFact | null => {
            if (!x) return null;
            const kind = String(x.kind ?? '');
            const value = String(x.value ?? '').trim();
            if (!allowed.has(kind) || value.length < 3) return null;
            if (kind === 'tech_fact') {
              const field = String(x.field ?? '');
              // No field = no check to close. Dropping beats guessing: a
              // mis-filed tech fact greens the wrong 1B row (the accident that
              // split `risk` out of `feasibility` on 2026-08-05).
              if (!techFields.has(field)) return null;
              return { kind: 'tech_fact', field: field as ExtractedFact['field'], value: value.slice(0, 300) };
            }
            return { kind: kind as NoteFactKind, value: value.slice(0, 300) };
          })
          .filter((x): x is ExtractedFact => x != null)
      : [];

    return { competitors, facts };
  } catch {
    return empty;
  }
}

/** Run the extraction. Returns empty on any failure — the caller stages a
 *  proposal only when something was actually found. */
export async function extractEntitiesFromNote(note: string): Promise<ExtractedEntities> {
  if (note.trim().length < NOTE_EXTRACT_MIN_CHARS) return { competitors: [], facts: [] };
  try {
    const res = await runAgent(buildNoteExtractionPrompt(note), { task: 'update-generate', traceName: 'note-entity-extract' });
    return parseEntityExtraction(String(res?.text ?? ''));
  } catch (err) {
    console.warn('[note-extract] failed (non-fatal):', (err as Error).message);
    return { competitors: [], facts: [] };
  }
}
