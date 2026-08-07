import { describe, it, expect } from 'vitest';
import { parseEntityExtraction, buildNoteExtractionPrompt, NOTE_EXTRACT_MIN_CHARS } from './note-entity-extract';

/**
 * #389 — notes reach the graph via a STAGED proposal, never a direct write.
 * What these pin is the defensive half: a model reply must never fabricate an
 * entity the parser then stages for the founder to approve.
 */
describe('parseEntityExtraction', () => {
  it('reads well-formed extractions, capping and trimming', () => {
    const r = parseEntityExtraction(JSON.stringify({
      competitors: [{ name: '  Corpore ', summary: '2.000+ fisioterapisti, €9,99/mese' }],
      partners: [{ name: 'AIFI', why: 'ordine professionale, canale ECM' }],
    }));
    expect(r.competitors).toEqual([{ name: 'Corpore', summary: '2.000+ fisioterapisti, €9,99/mese' }]);
    expect(r.partners[0].name).toBe('AIFI');
  });

  it('malformed / prose / empty ⇒ EMPTY, never a throw or an invented entity', () => {
    for (const bad of ['', 'nessuna entità', '{"competitors": "Corpore"}', '{oops', '{"competitors":[{"summary":"senza nome"}]}']) {
      const r = parseEntityExtraction(bad);
      expect(r.competitors, bad).toEqual([]);
      expect(r.partners, bad).toEqual([]);
    }
  });

  it('caps at 5 per kind — a rambling model must not flood the inbox card', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ name: `C${i}`, summary: 'x' }));
    expect(parseEntityExtraction(JSON.stringify({ competitors: many })).competitors).toHaveLength(5);
  });

  it('the prompt forbids inventing unnamed entities and carries the note', () => {
    const p = buildNoteExtractionPrompt('Oggi ho visto che Corpore ha alzato i prezzi');
    expect(p).toContain('never invent');
    expect(p).toContain('Corpore ha alzato i prezzi');
    expect(NOTE_EXTRACT_MIN_CHARS).toBeGreaterThan(0);
  });
});
