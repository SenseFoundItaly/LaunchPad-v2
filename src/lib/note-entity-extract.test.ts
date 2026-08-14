import { describe, it, expect } from 'vitest';
import {
  parseEntityExtraction, buildNoteExtractionPrompt, NOTE_EXTRACT_MIN_CHARS,
  NOTE_FACT_KINDS, NOTE_TECH_FIELDS,
} from './note-entity-extract';
import { isGatedWrite } from './journey/validation-targets';

/**
 * #389 — notes reach the graph via a STAGED proposal, never a direct write.
 * What these pin is the defensive half: a model reply must never fabricate an
 * entity the parser then stages for the founder to approve.
 *
 * v2 (2026-08-14) widened extraction from 2 kinds to 13. The new risk is a
 * model inventing a kind, so the allowlist is now the thing under test — and
 * the last test in this file checks the allowlist against the REAL mapping
 * rather than a copy of it, because a hand-kept second list is how the gate
 * ended up with four of them.
 */
describe('parseEntityExtraction', () => {
  it('reads well-formed extractions, capping and trimming', () => {
    const r = parseEntityExtraction(JSON.stringify({
      competitors: [{ name: '  Corpore ', summary: '2.000+ fisioterapisti, €9,99/mese' }],
      facts: [{ kind: 'partner_fact', value: 'AIFI — ordine professionale, canale ECM' }],
    }));
    expect(r.competitors).toEqual([{ name: 'Corpore', summary: '2.000+ fisioterapisti, €9,99/mese' }]);
    expect(r.facts[0]).toEqual({ kind: 'partner_fact', value: 'AIFI — ordine professionale, canale ECM' });
  });

  it('malformed / prose / empty ⇒ EMPTY, never a throw or an invented entity', () => {
    for (const bad of ['', 'nessuna entità', '{"competitors": "Corpore"}', '{oops', '{"competitors":[{"summary":"senza nome"}]}']) {
      const r = parseEntityExtraction(bad);
      expect(r.competitors, bad).toEqual([]);
      expect(r.facts, bad).toEqual([]);
    }
  });

  it('caps at 5 competitors — a rambling model must not flood the inbox card', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, summary: 'x' }));
    expect(parseEntityExtraction(JSON.stringify({ competitors: many })).competitors).toHaveLength(5);
  });

  it('caps at 8 facts', () => {
    const many = Array.from({ length: 20 }, () => ({ kind: 'gtm_fact', value: 'canale ordini regionali' }));
    expect(parseEntityExtraction(JSON.stringify({ facts: many })).facts).toHaveLength(8);
  });

  it('drops a kind that is not on the allowlist', () => {
    // An unknown kind has no source mapping, so it would stage an item the
    // executor can never apply — a silent orphan in the founder's inbox.
    const r = parseEntityExtraction(JSON.stringify({
      facts: [
        { kind: 'vibes_fact', value: 'sembra promettente' },
        { kind: 'canvas_field', value: 'il problema è X' },
        { kind: 'gtm_fact', value: 'i fisioterapisti si trovano negli ordini regionali' },
      ],
    }));
    expect(r.facts).toEqual([{ kind: 'gtm_fact', value: 'i fisioterapisti si trovano negli ordini regionali' }]);
  });

  it('tech_fact without a usable field is dropped, not guessed', () => {
    // Mis-filing greens the wrong 1B row — the accident that forced `risk` out
    // of `feasibility` on 2026-08-05.
    const r = parseEntityExtraction(JSON.stringify({
      facts: [
        { kind: 'tech_fact', value: 'serve un DPO' },
        { kind: 'tech_fact', field: 'vibes', value: 'difficile' },
        { kind: 'tech_fact', field: 'regulatory', value: 'GDPR: dati sanitari richiedono consenso esplicito' },
      ],
    }));
    expect(r.facts).toEqual([
      { kind: 'tech_fact', field: 'regulatory', value: 'GDPR: dati sanitari richiedono consenso esplicito' },
    ]);
  });

  it('drops an empty or one-word value', () => {
    const r = parseEntityExtraction(JSON.stringify({
      facts: [{ kind: 'gtm_fact', value: '  ' }, { kind: 'ip_fact', value: 'x' }],
    }));
    expect(r.facts).toEqual([]);
  });

  it('the prompt forbids inventing unnamed entities and carries the note', () => {
    const p = buildNoteExtractionPrompt('Oggi ho visto che Corpore ha alzato i prezzi');
    expect(p).toContain('never invent');
    expect(p).toContain('Corpore ha alzato i prezzi');
    expect(NOTE_EXTRACT_MIN_CHARS).toBeGreaterThan(0);
  });

  it('the prompt describes every kind it accepts', () => {
    // A kind on the allowlist but absent from the prompt is a kind the model
    // will never emit — the allowlist would lie about what a note can do.
    const p = buildNoteExtractionPrompt('x'.repeat(40));
    for (const k of NOTE_FACT_KINDS) expect(p, k).toContain(k);
    for (const f of NOTE_TECH_FIELDS) expect(p, f).toContain(f);
  });
});

describe('every kind a note can stage actually closes a check', () => {
  it.each(NOTE_FACT_KINDS.filter((k) => k !== 'tech_fact'))('%s maps to a spine substep', (kind) => {
    // Checked against validation-targets itself: this is what makes the
    // allowlist a real guarantee rather than a second hand-kept copy.
    expect(isGatedWrite(kind)).toBe(true);
  });

  it.each(NOTE_TECH_FIELDS)('tech_fact/%s maps to a spine substep', (field) => {
    expect(isGatedWrite('tech_fact', field)).toBe(true);
  });

  it('competitor — the one kind carrying a name — maps too', () => {
    expect(isGatedWrite('competitor')).toBe(true);
  });
});
