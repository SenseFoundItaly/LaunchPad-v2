import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Changelog 05/09 — the items that needed no product decision.
 *
 * Each one is pinned where a future edit would silently undo it: a field
 * re-added to a view, a panel that stops collapsing, a card that loses its
 * download.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const ART = 'src/components/chat/artifacts';

describe('item 6 — the business model leaves the Idea Canvas VIEW, not the schema', () => {
  it('no canvas view renders the business model field', () => {
    expect(read(`${ART}/IdeaCanvasCard.tsx`)).not.toMatch(/canvas\.field-business-model/);
    const header = read('src/components/canvas/IdeaCanvasHeader.tsx');
    expect(header).not.toMatch(/<Field label=\{t\('canvas\.field-business-model'\)/);
    expect(header).not.toMatch(/\['business_model', t\('canvas\.field-business-model'\)/);
    expect(read('src/components/canvas/SpineSection.tsx')).toMatch(
      /CANVAS_VIEW_FIELDS = new Set\(\['problem', 'solution', 'target_market', 'value_proposition'\]\)/,
    );
  });

  it('the column and its data survive — this is a view change, not a deletion', () => {
    // Luca asked for it to be worked in its own stage, not thrown away.
    expect(read('src/components/canvas/IdeaCanvasHeader.tsx')).toMatch(/business_model\?: string \| null/);
    // The write path is untouched, so anything already captured is still there
    // and the later stage has something to build on.
    expect(read('src/lib/canvas-details.ts')).toMatch(/business_model/);
  });
});

describe('item 10 — the competitor panel stops covering the graph', () => {
  const src = read('src/components/knowledge/CompetitorMatryoshka.tsx');

  it('collapses, and says so to a screen reader', () => {
    expect(src).toMatch(/aria-expanded=\{open\}/);
    expect(src).toMatch(/aria-controls=\{listId\}/);
    expect(src).toMatch(/hidden=\{!open\}/);
  });

  it('is operable from the keyboard, not just the mouse', () => {
    // A div with onClick and no key handling is a trap for keyboard users.
    expect(src).toMatch(/onKeyDown=/);
    expect(src).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
    expect(src).toMatch(/tabIndex=\{0\}/);
  });

  it('remembers the choice per project', () => {
    expect(src).toMatch(/lp_competitors_open_\$\{projectId\}/);
    // Storage can throw (private mode) — it must never take the panel down.
    expect(src).toMatch(/catch \{/);
  });
});

describe('item 2 — every artifact the exporter understands offers a download', () => {
  const exporter = read('src/lib/artifact-export.ts');
  const supported = [...exporter.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]);

  it('the exporter really does cover these types', () => {
    for (const t of ['action-suggestion', 'monitor-proposal', 'budget-proposal', 'validation-proposal']) {
      expect(supported, `${t} missing from artifact-export`).toContain(t);
    }
  });

  it('the cards for them pass exportArtifact through to the shell', () => {
    for (const card of [
      'ActionSuggestionCard', 'MonitorProposalCard', 'BudgetProposalCard', 'ValidationProposalCard',
      'MetricGridCard',
    ]) {
      expect(read(`${ART}/${card}.tsx`), card).toMatch(/exportArtifact=\{artifact\}/);
    }
  });

  it('coverage went up and is worth reporting', () => {
    const files = readdirSync(join(process.cwd(), ART)).filter((f) => f.endsWith('.tsx'));
    const withExport = files.filter((f) => read(`${ART}/${f}`).includes('exportArtifact'));
    // Was 18/32 before this change; the rest are sub-components (footers,
    // chips, controls) or carry their own bespoke download.
    expect(withExport.length).toBeGreaterThanOrEqual(22);
  });
});
