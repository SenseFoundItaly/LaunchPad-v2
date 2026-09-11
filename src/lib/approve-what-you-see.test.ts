import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { en } from './i18n/messages/en';
import { it as itMessages } from './i18n/messages/it';

/**
 * Changelog 05/09 items 7g + 12 — "Ho ricevuto la richiesta di applicare tutti
 * questi output (che non avevo ancora potuto vedere)."
 *
 * This read like a product question ("narrow what auto-stages, or explain it")
 * until the card itself was opened: the item's value was cut at 220 characters
 * with no way to read the rest. The only route to the full text was clicking
 * *edit* and scrolling a textarea — on a card whose entire job is to ask for
 * approval. Same truncation-with-no-escape as item 12's knowledge list, in a
 * worse place.
 *
 * Measured 2026-09-10: 50 of 92 prod validation proposals carry 2+ items, up
 * to 10 — so this is the normal case, not an edge one.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const card = read('src/components/chat/artifacts/ValidationProposalCard.tsx');

describe('you can read what you are approving', () => {
  it('a long value can be opened without entering edit mode', () => {
    expect(card).toMatch(/vp\.show-full/);
    expect(card).toMatch(/aria-expanded=\{expanded\.has\(it\.id\)\}/);
  });

  it('the cut is a named constant, not a literal buried in the markup', () => {
    expect(card).toMatch(/const VALUE_PREVIEW_CHARS = 220;/);
    expect(card).toMatch(/curValue\.length > VALUE_PREVIEW_CHARS && !expanded\.has\(it\.id\)/);
  });

  it('and the opened text keeps the shape the analysis was written in', () => {
    // Findings arrive with line breaks; collapsing them to one run is how a
    // readable paragraph becomes a wall.
    expect(card).toMatch(/whitespace-pre-wrap break-words/);
  });

  it('both languages have the control', () => {
    for (const k of ['vp.show-full', 'vp.show-less'] as const) {
      expect(en[k], `${k} en`).toBeTruthy();
      expect(itMessages[k], `${k} it`).toBeTruthy();
    }
  });
});

describe('the competitor CTA cannot land on a hidden list', () => {
  it('deep-links to the panel, not just the page', () => {
    // Item 10 made the panel remember being collapsed (it covered the graph).
    // Item 7f's CTA sends the founder to Knowledge. A founder who had collapsed
    // it once then arrived at a page with the list hidden — two of my own
    // changes meeting badly.
    expect(read('src/lib/competitor-review-cta.ts')).toMatch(/navigate_to: 'knowledge-competitors'/);
  });

  it('the destination is still whitelisted — no free URL from artifact text', () => {
    const page = read('src/app/project/[projectId]/chat/page.tsx');
    expect(page).toMatch(/'knowledge-competitors': `\/project\/\$\{projectId\}\/knowledge\?focus=competitors`/);
    expect(page).toMatch(/if \(!href\) throw new Error/);
  });

  it('and the panel opens on that arrival, overriding the remembered state', () => {
    const panel = read('src/components/knowledge/CompetitorMatryoshka.tsx');
    expect(panel).toMatch(/get\('focus'\) === 'competitors'/);
    // The override must run BEFORE the saved state is read, or localStorage wins.
    const focus = panel.indexOf("get('focus')");
    const saved = panel.indexOf('localStorage.getItem(storageKey)');
    expect(focus).toBeGreaterThan(-1);
    expect(focus, 'the focus check must precede the saved-state read').toBeLessThan(saved);
  });
});
