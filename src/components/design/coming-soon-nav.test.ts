import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { en } from '@/lib/i18n/messages/en';
import { it as itMessages } from '@/lib/i18n/messages/it';

/**
 * WIP sections are shown "coming soon", not removed (2026-09-11).
 *
 * Build & Launch is behind NEXT_PUBLIC_BUILD_ENABLED, unset in production, and
 * the nav entry was filtered out entirely — so in prod the section did not
 * exist as far as the founder could tell.
 *
 * Same reasoning as the stage roadmap (changelog 05/09 item 1): a founder who
 * cannot see what is coming reads the product as smaller than it is. That item
 * was asked TWICE because the 28/08 roadmap rows were added and never rendered.
 *
 * Inert is the load-bearing half. A visible entry that navigated into an
 * unfinished hub would be the dead end this codebase keeps having to fix — so
 * the coming-soon entry is not a Link at all.
 */

const chrome = readFileSync(join(process.cwd(), 'src/components/design/chrome.tsx'), 'utf-8');

describe('a WIP section is visible but cannot be entered', () => {
  it('the flagged-off entry is marked, not filtered away', () => {
    expect(chrome).toMatch(/comingSoon: true/);
    expect(chrome, 'the old filter must be gone').not.toMatch(/PRIMARY_ITEMS\.filter\(/);
  });

  it('renders as a span, never a Link — a faint link still navigates', () => {
    expect(chrome).toMatch(/item\.comingSoon \? 'span' : Link/);
    expect(chrome).toMatch(/'aria-disabled': true/);
  });

  it('is visually and semantically inert', () => {
    expect(chrome).toMatch(/cursor: item\.comingSoon \? 'default' : 'pointer'/);
    expect(chrome).toMatch(/opacity: item\.comingSoon \? 0\.45 : 1/);
  });

  it('says WHY it is faint — an icon alone reads as broken, not as not-yet', () => {
    expect(chrome).toMatch(/item\.comingSoon \? `\$\{label\} · \$\{comingSoonLabel\}` : label/);
  });

  it('still lets the flag turn it fully on for staging', () => {
    expect(chrome).toMatch(/NEXT_PUBLIC_BUILD_ENABLED === '1'/);
    expect(chrome).toMatch(/it\.id === 'build' && !BUILD_NAV_ENABLED/);
  });

  it('borrows the roadmap’s own vocabulary, in both languages', () => {
    expect(en['nav.coming-soon']).toBeTruthy();
    expect(itMessages['nav.coming-soon']).toBeTruthy();
    // The stage roadmap already says "in arrivo" for the same idea; two
    // different phrases for one concept is how a product starts sounding
    // assembled rather than designed.
    expect(itMessages['nav.coming-soon']).toBe(itMessages['canvas.planned-soon']);
  });
});
