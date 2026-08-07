import { describe, it, expect } from 'vitest';
import { buildArtifactMarkdown, markdownToPrintHtml, buildArtifactExport } from './artifact-export';
import { splitVerdict } from './score-display';
import type { Artifact } from '@/types/artifacts';

/**
 * #390 (changelog 4/08): artifact download was JSON-only; the founder forwards
 * these to co-founders and advisors, so the export needed human formats. These
 * pin the two properties that matter:
 *   1. the markdown is a DOCUMENT (title, tables, sources) — never raw JSON;
 *   2. the print-HTML path escapes artifact text BEFORE converting, because
 *      that text is agent/web-sourced and lands in a window we ask the browser
 *      to print. A crafted competitor name must render as text, not markup.
 */

const table = {
  type: 'comparison-table', id: 'a1', title: 'Competitor pricing',
  columns: ['Corpore', 'Physitrack'],
  rows: [{ label: 'Prezzo/mese', values: ['€9,99', '€12'] }],
  sources: [{ type: 'web', title: 'Corpore pricing', url: 'https://corpore.example/pricing' }],
} as unknown as Artifact;

describe('buildArtifactMarkdown', () => {
  it('renders a comparison table as a markdown table with sources', () => {
    const doc = buildArtifactMarkdown(table)!;
    expect(doc.filename).toBe('competitor-pricing.md');
    expect(doc.text).toContain('# Competitor pricing');
    expect(doc.text).toContain('| Prezzo/mese | €9,99 | €12 |');
    expect(doc.text).toContain('## Sources');
    expect(doc.text).toContain('https://corpore.example/pricing');
    // A document, not a dump.
    expect(doc.text).not.toContain('{');
  });

  it('renders unknown artifact shapes as readable fields, never raw JSON', () => {
    const doc = buildArtifactMarkdown({
      type: 'persona-card', id: 'p1', title: 'Titolare di studio',
      pain_points: ['Onboarding lento', 'Rischio compliance'],
      segment: 'PMI regolamentate',
      sources: [],
    } as unknown as Artifact)!;
    expect(doc.text).toContain('**Segment:** PMI regolamentate');
    expect(doc.text).toContain('- Onboarding lento');
    expect(doc.text).not.toContain('"pain_points"');
  });

  it('skips the same interactive cards the data export skips', () => {
    const opt = { type: 'option-set', id: 'o1', prompt: 'x', options: [] } as unknown as Artifact;
    expect(buildArtifactExport(opt)).toBeNull();
    expect(buildArtifactMarkdown(opt)).toBeNull();
  });
});

describe('markdownToPrintHtml', () => {
  it('escapes artifact text before converting — untrusted content stays text', () => {
    const html = markdownToPrintHtml('# T\n\n| A |\n|---|\n| <script>alert(1)</script> |\n\n- <img src=x onerror=y>', 'T');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('converts only the constructs the builder emits', () => {
    const html = markdownToPrintHtml('# Titolo\n\n**bold** text\n\n- uno\n- due\n\n| a | b |\n|---|---|\n| 1 | 2 |', 'Doc');
    expect(html).toContain('<h1>Titolo</h1>');
    expect(html).toContain('<b>bold</b>');
    expect(html).toContain('<li>uno</li>');
    expect(html).toContain('<td>1</td>');
  });
});

describe('splitVerdict (shared by ScorePanel and BaselineScoreCard)', () => {
  it('peels only the three known verdicts', () => {
    expect(splitVerdict('GO — Idea chiara.')).toEqual({ verdict: 'GO', text: 'Idea chiara.' });
    expect(splitVerdict('PIVOT PARZIALE — ICP vago.')).toEqual({ verdict: 'PIVOT PARZIALE', text: 'ICP vago.' });
    // Arbitrary prefixes are prose — they must never become a badge.
    expect(splitVerdict('GOAL: crescere')).toEqual({ verdict: null, text: 'GOAL: crescere' });
    expect(splitVerdict(null)).toEqual({ verdict: null, text: null });
  });
});
