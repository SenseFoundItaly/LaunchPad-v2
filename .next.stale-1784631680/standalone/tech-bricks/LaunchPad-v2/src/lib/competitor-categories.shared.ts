/**
 * competitor-categories.shared — the CLIENT-SAFE half of the competitor
 * matryoshka (item 14): taxonomy, labels, pure mappers, and the row/tree types.
 *
 * Kept separate from competitor-categories.ts (which imports @/lib/db / postgres)
 * so client components — e.g. CompetitorMatryoshka — can import the category
 * labels + types WITHOUT dragging the server-only `postgres` module (and `fs`)
 * into the browser bundle. NO db / server imports may be added here.
 */

import type { Source } from '@/types/artifacts';

export const COMPETITOR_CATEGORIES = [
  'general',
  'product',
  'pricing',
  'distribution',
  'marketing',
  'competitive_advantage',
  'criticality',
] as const;
export type CompetitorCategory = (typeof COMPETITOR_CATEGORIES)[number];

/** Founder-facing i18n key for a category (resolved at the render site). */
export const CATEGORY_LABEL_KEY: Record<CompetitorCategory, string> = {
  general: 'competitors.cat-general',
  product: 'competitors.cat-product',
  pricing: 'competitors.cat-pricing',
  distribution: 'competitors.cat-distribution',
  marketing: 'competitors.cat-marketing',
  competitive_advantage: 'competitors.cat-advantage',
  criticality: 'competitors.cat-criticality',
};

// Keyword → category. First match wins; unmatched columns fall to 'general'.
const CATEGORY_RULES: Array<{ re: RegExp; cat: CompetitorCategory }> = [
  { re: /(price|pricing|cost|plan|tier|fee|subscription|€|\$)/i, cat: 'pricing' },
  { re: /(channel|distribution|gtm|go.to.market|sales|partnership)/i, cat: 'distribution' },
  { re: /(market|brand|positioning|messaging|audience|campaign|seo|content)/i, cat: 'marketing' },
  { re: /(advantage|differentiat|moat|edge|unique|defensib|strength)/i, cat: 'competitive_advantage' },
  { re: /(risk|threat|critical|severity|weakness|danger)/i, cat: 'criticality' },
  { re: /(product|feature|capabilit|tech|integration|ux|platform)/i, cat: 'product' },
];

/** Map a comparison-table column name to a canonical competitor category. */
export function categoryForColumn(column: string): CompetitorCategory {
  for (const { re, cat } of CATEGORY_RULES) {
    if (re.test(column)) return cat;
  }
  return 'general';
}

/**
 * Normalize a free-text category label (the agent may pass "Pricing", "moat",
 * "channels", …) to a canonical category. Falls back to keyword mapping.
 */
export function normalizeCategory(input: string): CompetitorCategory {
  const lc = (input || '').trim().toLowerCase().replace(/\s+/g, '_');
  if ((COMPETITOR_CATEGORIES as readonly string[]).includes(lc)) return lc as CompetitorCategory;
  if (['competitive_edge', 'advantage', 'advantages', 'moat', 'differentiation', 'differentiator'].includes(lc)) return 'competitive_advantage';
  if (['price', 'prices', 'cost', 'plans'].includes(lc)) return 'pricing';
  if (['gtm', 'channel', 'channels', 'go_to_market', 'sales'].includes(lc)) return 'distribution';
  if (['risk', 'threat', 'criticality_level', 'severity'].includes(lc)) return 'criticality';
  return categoryForColumn(input);
}

export interface CompetitorCategoryRow {
  category: CompetitorCategory;
  detail: string;
  sources: Source[] | null;
}
export interface CompetitorWithCategories {
  id: string;
  name: string;
  summary: string | null;
  reviewed_state: string;
  categories: CompetitorCategoryRow[];
}
