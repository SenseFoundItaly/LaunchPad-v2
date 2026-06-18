/**
 * competitor-categories — the "matryoshka" breakdown for changelog item 14.
 *
 * A competitor (graph_nodes, node_type='competitor', founder-approval-gated) is
 * decomposed into CATEGORIES so the founder can open it and see each dimension:
 *   startup → competitor → category → detail.
 *
 * Source of the categories: the comparison-table the agent already emits has
 * COLUMNS that are category-shaped (pricing, product, channels, …). We map each
 * column to a canonical category instead of inventing a separate analysis step —
 * reusing the agent output the founder already approves.
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
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
 * UPSERT the category breakdown for one competitor node from a row's
 * column→value attributes. Columns are grouped by mapped category and joined,
 * so each (competitor, category) is a single row (the unique index dedups).
 * Best-effort + non-fatal: a category write must never break the artifact flush.
 */
export async function persistCompetitorCategories(
  projectId: string,
  competitorNodeId: string,
  attributes: Record<string, unknown>,
  sources?: Source[] | null,
): Promise<number> {
  const grouped = new Map<CompetitorCategory, string[]>();
  for (const [col, raw] of Object.entries(attributes)) {
    const value = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
    if (!value || value === '—') continue;
    const cat = categoryForColumn(col);
    const arr = grouped.get(cat) ?? [];
    arr.push(`${col}: ${value}`);
    grouped.set(cat, arr);
  }
  const srcJson = sources && sources.length > 0 ? JSON.stringify(sources) : null;
  let written = 0;
  for (const [cat, details] of grouped) {
    try {
      await run(
        `INSERT INTO competitor_categories (id, project_id, competitor_node_id, category, detail, sources)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (competitor_node_id, category) DO UPDATE SET
           detail = EXCLUDED.detail,
           sources = COALESCE(EXCLUDED.sources, competitor_categories.sources),
           updated_at = CURRENT_TIMESTAMP`,
        generateId('ccat'),
        projectId,
        competitorNodeId,
        cat,
        details.join('; ').slice(0, 1500),
        srcJson,
      );
      written++;
    } catch (err) {
      console.warn('[competitor-categories] upsert failed (non-fatal):', (err as Error).message);
    }
  }
  return written;
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

/**
 * Read the matryoshka: each competitor node (applied + pending) with its
 * categories nested, ordered by the canonical category order. Powers the
 * textual competitor view on the Knowledge page (item 14: Knowledge = textual graph).
 */
export async function readCompetitorMatryoshka(projectId: string): Promise<CompetitorWithCategories[]> {
  const nodes = await query<{ id: string; name: string; summary: string | null; reviewed_state: string }>(
    `SELECT id, name, summary, reviewed_state
       FROM graph_nodes
      WHERE project_id = ? AND node_type = 'competitor'
        AND reviewed_state IN ('applied', 'pending')
      ORDER BY CASE reviewed_state WHEN 'applied' THEN 0 ELSE 1 END, name`,
    projectId,
  );
  if (nodes.length === 0) return [];

  const cats = await query<{ competitor_node_id: string; category: string; detail: string; sources: unknown }>(
    `SELECT competitor_node_id, category, detail, sources
       FROM competitor_categories WHERE project_id = ?`,
    projectId,
  );
  const order = (c: string) => {
    const i = (COMPETITOR_CATEGORIES as readonly string[]).indexOf(c);
    return i === -1 ? COMPETITOR_CATEGORIES.length : i;
  };
  const byNode = new Map<string, CompetitorCategoryRow[]>();
  for (const c of cats) {
    const arr = byNode.get(c.competitor_node_id) ?? [];
    arr.push({
      category: c.category as CompetitorCategory,
      detail: c.detail,
      sources: Array.isArray(c.sources) ? (c.sources as Source[]) : null,
    });
    byNode.set(c.competitor_node_id, arr);
  }
  for (const arr of byNode.values()) arr.sort((a, b) => order(a.category) - order(b.category));

  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    summary: n.summary,
    reviewed_state: n.reviewed_state,
    categories: byNode.get(n.id) ?? [],
  }));
}
