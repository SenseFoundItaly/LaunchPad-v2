/**
 * brand-palette.ts — centralised categorical colour mappings.
 *
 * Every component that needs a "colour by category" look-up imports from
 * here instead of hard-coding Tailwind or hex colours. The palette entries
 * reference design-tokens.css variables so they flip automatically between
 * light (`:root`) and dark (`.theme-ink`) themes.
 */

// ---------------------------------------------------------------------------
// Categorical palette — 8 brand-safe slots
// ---------------------------------------------------------------------------

export interface CatEntry {
  /** Tailwind text class, e.g. "text-clay" */
  text: string;
  /** Tailwind bg class, e.g. "bg-clay" */
  bg: string;
  /** Tailwind wash bg class, e.g. "bg-clay-wash" */
  wash: string;
  /** Tailwind wash text + bg combo for chips, e.g. "bg-clay-wash text-clay" */
  chip: string;
  /** CSS variable for inline styles, e.g. "var(--clay)" */
  solid: string;
}

export const CAT_PALETTE: CatEntry[] = [
  { text: 'text-clay',     bg: 'bg-clay',     wash: 'bg-clay-wash',     chip: 'bg-clay-wash text-clay',         solid: 'var(--clay)' },
  { text: 'text-moss',     bg: 'bg-moss',     wash: 'bg-moss-wash',     chip: 'bg-moss-wash text-moss',         solid: 'var(--moss)' },
  { text: 'text-sky',      bg: 'bg-sky',      wash: 'bg-sky-wash',      chip: 'bg-sky-wash text-sky',           solid: 'var(--sky)' },
  { text: 'text-plum',     bg: 'bg-plum',     wash: 'bg-plum-wash',     chip: 'bg-plum-wash text-plum',         solid: 'var(--plum)' },
  { text: 'text-accent',   bg: 'bg-accent',   wash: 'bg-accent-wash',   chip: 'bg-accent-wash text-accent',     solid: 'var(--accent)' },
  { text: 'text-cat-teal', bg: 'bg-cat-teal', wash: 'bg-cat-teal-wash', chip: 'bg-cat-teal-wash text-cat-teal', solid: 'var(--cat-teal)' },
  { text: 'text-cat-gold', bg: 'bg-cat-gold', wash: 'bg-cat-gold-wash', chip: 'bg-cat-gold-wash text-cat-gold', solid: 'var(--cat-gold)' },
  { text: 'text-cat-rose', bg: 'bg-cat-rose', wash: 'bg-cat-rose-wash', chip: 'bg-cat-rose-wash text-cat-rose', solid: 'var(--cat-rose)' },
];

// ---------------------------------------------------------------------------
// Entity types → palette index
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_PALETTE: Record<string, number> = {
  competitor:     0,   // clay
  technology:     5,   // cat-teal
  market_segment: 1,   // moss
  persona:        6,   // cat-gold
  risk:           7,   // cat-rose
  trend:          3,   // plum
  company:        2,   // sky
  compliance:     7,   // cat-rose
  regulation:     7,   // cat-rose
  partner:        5,   // cat-teal
  funding_source: 1,   // moss
  feature:        3,   // plum
  metric:         2,   // sky
};

// ---------------------------------------------------------------------------
// Insight categories → palette index
// ---------------------------------------------------------------------------

export const INSIGHT_PALETTE: Record<string, number> = {
  competitor:  0,   // clay
  market:      1,   // moss
  risk:        7,   // cat-rose
  opportunity: 2,   // sky
  technology:  5,   // cat-teal
};

// ---------------------------------------------------------------------------
// Workflow categories → palette index
// ---------------------------------------------------------------------------

export const WORKFLOW_PALETTE: Record<string, number> = {
  hiring:      6,   // cat-gold
  marketing:   2,   // sky
  fundraising: 1,   // moss
  product:     3,   // plum
  legal:       7,   // cat-rose
  operations:  5,   // cat-teal
  sales:       4,   // accent
};

// ---------------------------------------------------------------------------
// Monitor kinds → palette index
// ---------------------------------------------------------------------------

export const MONITOR_KIND_PALETTE: Record<string, number> = {
  competitor:  0,   // clay
  regulation:  7,   // cat-rose
  market:      1,   // moss
  partner:     5,   // cat-teal
  technology:  5,   // cat-teal
  funding:     6,   // cat-gold
  custom:      -1,  // fallback (ink-5)
};

// ---------------------------------------------------------------------------
// Score colour — three-band green/gold/clay
// ---------------------------------------------------------------------------

export function scoreColor(pct: number): string {
  if (pct >= 0.75) return 'var(--moss)';
  if (pct >= 0.5)  return 'var(--cat-gold)';
  return 'var(--clay)';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get the palette entry for an entity type, with fallback. */
export function entityPalette(entityType: string): CatEntry {
  const idx = ENTITY_TYPE_PALETTE[entityType];
  return idx != null ? CAT_PALETTE[idx] : { text: 'text-ink-4', bg: 'bg-ink-5/20', wash: 'bg-ink-5/20', chip: 'bg-ink-5/20 text-ink-4', solid: 'var(--ink-5)' };
}

/** Get the palette entry for an insight category, with fallback. */
export function insightPalette(category: string): CatEntry {
  const idx = INSIGHT_PALETTE[category];
  return idx != null ? CAT_PALETTE[idx] : { text: 'text-ink-4', bg: 'bg-ink-5/20', wash: 'bg-ink-5/20', chip: 'bg-ink-5/20 text-ink-4', solid: 'var(--ink-5)' };
}

/** Get the palette entry for a workflow category, with fallback. */
export function workflowPalette(category: string): CatEntry {
  const idx = WORKFLOW_PALETTE[category];
  return idx != null ? CAT_PALETTE[idx] : { text: 'text-ink-4', bg: 'bg-ink-5/20', wash: 'bg-ink-5/20', chip: 'bg-ink-5/20 text-ink-4', solid: 'var(--ink-5)' };
}

/** Get the palette entry for a monitor kind, with fallback. */
export function monitorPalette(kind: string): CatEntry {
  const idx = MONITOR_KIND_PALETTE[kind];
  if (idx == null || idx < 0) return { text: 'text-ink-3', bg: 'bg-ink-5/20', wash: 'bg-ink-5/20', chip: 'bg-ink-5/20 text-ink-3', solid: 'var(--ink-5)' };
  return CAT_PALETTE[idx];
}
