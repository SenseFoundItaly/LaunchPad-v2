import type { Source } from '@/types/artifacts';

export type GraphNodeType =
  | 'your_startup'
  | 'competitor'
  | 'technology'
  | 'market_segment'
  | 'persona'
  | 'risk'
  | 'trend'
  | 'company'
  | 'compliance'
  | 'regulation'
  | 'partner'
  | 'funding_source'
  | 'feature'
  | 'metric';

/**
 * Macro-category grouping — the "matrioska" the founder asked for in the
 * 2026-06 weekly sync: the graph was "disordinato" (a flat mix of competitors,
 * options nodes, market sizing). Node types collapse into a handful of
 * founder-legible buckets so the graph clusters by ecosystem role (concorrenza
 * / clienti / partner / investitori) with everything else under "contesto".
 * your_startup is the root and has no macro-category (it sits at center).
 */
export type MacroCategory = 'concorrenza' | 'clienti' | 'partner' | 'investitori' | 'contesto';

export const MACRO_CATEGORY: Record<GraphNodeType, MacroCategory | null> = {
  your_startup: null,
  competitor: 'concorrenza',
  company: 'concorrenza',
  persona: 'clienti',
  market_segment: 'clienti',
  partner: 'partner',
  funding_source: 'investitori',
  technology: 'contesto',
  trend: 'contesto',
  risk: 'contesto',
  compliance: 'contesto',
  regulation: 'contesto',
  feature: 'contesto',
  metric: 'contesto',
};

/** Stable render order (clockwise from the right) + bilingual labels. */
export const MACRO_CATEGORY_ORDER: MacroCategory[] = [
  'concorrenza', 'clienti', 'partner', 'investitori', 'contesto',
];

export const MACRO_CATEGORY_LABEL: Record<MacroCategory, { en: string; it: string }> = {
  concorrenza: { en: 'Competition', it: 'Concorrenza' },
  clienti: { en: 'Customers', it: 'Clienti' },
  partner: { en: 'Partners', it: 'Partner' },
  investitori: { en: 'Investors', it: 'Investitori' },
  contesto: { en: 'Context', it: 'Contesto' },
};

export function macroCategoryFor(type: string): MacroCategory | null {
  return MACRO_CATEGORY[type as GraphNodeType] ?? 'contesto';
}

export interface GraphNode {
  id: string;
  /** Owning project — returned by /api/graph (SELECT *); used for lazy fetches. */
  project_id?: string;
  name: string;
  node_type: GraphNodeType;
  summary: string;
  attributes: Record<string, unknown>;
  /**
   * Provenance links for this node — web URLs, skill runs, founder quotes, etc.
   * Already returned by /api/graph (SELECT *), but historically untyped here so
   * the detail panel could surface the founder-facing "where did this come from".
   */
  sources?: Source[];
  /** ISO timestamp the node was captured. Returned by the API; shown in the panel. */
  created_at?: string;
  /** 'pending' = a proposal the founder hasn't applied yet (renders dashed). */
  reviewed_state?: 'applied' | 'pending' | 'rejected';
  /** AI-generated "why this matters" sentence, cached on first view (lazy,
   *  flag-gated). When absent the panel falls back to the per-type template. */
  importance?: string | null;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphEdge {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  relation: string;
  label?: string;
  weight: number;
  /** Synthesized root→node link for an otherwise-unconnected node (not in DB). */
  virtual?: boolean;
}

export interface KnowledgeGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const NODE_COLORS: Record<string, string> = {
  your_startup: 'var(--ink)',
  competitor: 'var(--clay)',
  technology: 'var(--cat-teal)',
  market_segment: 'var(--moss)',
  persona: 'var(--cat-gold)',
  risk: 'var(--cat-rose)',
  trend: 'var(--plum)',
  company: 'var(--sky)',
  compliance: 'var(--cat-rose)',
  regulation: 'var(--cat-rose)',
  partner: 'var(--cat-teal)',
  funding_source: 'var(--moss)',
  feature: 'var(--plum)',
  metric: 'var(--sky)',
};
