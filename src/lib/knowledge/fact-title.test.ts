import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { factTitle } from './unified';

/**
 * Changelog 05/09 item 12 — "nella knowledge elenco vedo riquadri di testo
 * tagliati. Dobbiamo trovare un modo di rappresentare con più chiarezza ogni
 * dato e informazione altrimenti il valore si perde per strada."
 *
 * Measured on prod 2026-09-09, 522 facts:
 *   · 131 run past 500 characters
 *   · 6 run past 20,000 — whole uploaded files stored as a single fact
 *     (the longest is 49,984)
 *
 * A fact has no title, so the list showed its opening text via a flat
 * slice(0, 120) — cut mid-word — and the row then clipped THAT again to one
 * nowrap line with an ellipsis. A 700-character finding reached the founder as
 * roughly sixty characters, truncated twice, ending mid-syllable.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('a fact gets a title a person can read', () => {
  it('leaves a short fact exactly as it is', () => {
    expect(factTitle('GDPR applies: we need a DPA with every vendor.'))
      .toBe('GDPR applies: we need a DPA with every vendor.');
  });

  it('cuts at the end of a sentence when there is one', () => {
    const t = factTitle(
      'The recall engine is feasible with existing calendar APIs. The main technical risk is EHR integration, which varies by vendor and is undocumented in most Italian practice-management systems.',
    );
    expect(t).toBe('The recall engine is feasible with existing calendar APIs.');
    expect(t).not.toMatch(/…$/);
  });

  it('never cuts mid-word — that was the actual complaint', () => {
    const t = factTitle('a'.padEnd(40, 'a') + ' ' + 'buyer persona research shows practice owners decide alone '.repeat(6));
    expect(t.replace(/…$/, '').endsWith(' ')).toBe(false);
    // Whatever it ends on is a whole word.
    const words = t.replace(/…$/, '').split(' ');
    expect(words[words.length - 1]).not.toBe('');
  });

  it('collapses the whitespace an uploaded file drags in', () => {
    // The 20k-50k character rows are markdown documents: newlines and runs of
    // spaces would render as a ragged, mostly-blank two-line row.
    expect(factTitle('# Heading\n\n   Some    body\ttext here')).toBe('# Heading Some body text here');
  });

  it('survives the 50,000-character file without producing a wall of text', () => {
    const huge = 'Uploaded file: notes.md ' + 'lorem ipsum dolor sit amet '.repeat(2000);
    const t = factTitle(huge);
    expect(t.length).toBeLessThanOrEqual(161);
    expect(t).toMatch(/…$/);
  });

  it('degrades safely on input with no spaces at all', () => {
    const t = factTitle('x'.repeat(500));
    expect(t.length).toBeLessThanOrEqual(161);
  });
});

describe('the row shows what the title now contains', () => {
  const panel = read('src/components/knowledge/AllKnowledgePanel.tsx');

  it('two lines, not one clipped line', () => {
    expect(panel).toMatch(/WebkitLineClamp: 2/);
    expect(panel).not.toMatch(/whiteSpace: 'nowrap'/);
  });

  it('and the expanded body is capped, so one uploaded file cannot take the page', () => {
    expect(panel).toMatch(/maxHeight: 420, overflowY: 'auto'/);
  });

  it('the full text is still there — this is a display change, not a truncation', () => {
    // `summary` carries the untouched fact; the expanded row renders it.
    expect(read('src/lib/knowledge/unified.ts'))
      .toMatch(/summary: \(f\.fact \?\? ''\)\.length > title\.length \? f\.fact : null/);
  });
});
