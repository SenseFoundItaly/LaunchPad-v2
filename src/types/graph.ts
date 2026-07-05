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
  | 'metric'
  // Derived-analysis node types minted by chat artifacts (metric-grid,
  // comparison-table). They were historically absent from the colour/category
  // maps → rendered as anonymous grey dots outside every legend/region. They
  // are ecosystem CONTEXT (benchmarks, metric snapshots, comparisons), except
  // competitor_set (a set of competitors → competition) and market (a market →
  // customers). Note `metrics` (plural) is the DB value; `metric` is the legacy
  // singular — both are mapped.
  | 'metrics'
  | 'benchmark'
  | 'comparison'
  | 'competitor_set'
  | 'research_metric'
  | 'market'
  // Fallback type for watcher signals whose alert_type has no specific mapping
  // (nodeTypeForAlert default). Must stay in every map below or these nodes
  // render as anonymous grey dots outside the legend/regions.
  | 'signal';

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
  competitor_set: 'concorrenza',
  persona: 'clienti',
  market_segment: 'clienti',
  market: 'clienti',
  partner: 'partner',
  funding_source: 'investitori',
  technology: 'contesto',
  trend: 'contesto',
  signal: 'contesto',
  risk: 'contesto',
  compliance: 'contesto',
  regulation: 'contesto',
  feature: 'contesto',
  metric: 'contesto',
  metrics: 'contesto',
  benchmark: 'contesto',
  comparison: 'contesto',
  research_metric: 'contesto',
};

/**
 * One tint per macro-category — the soft background wash that groups each
 * ecosystem region on the graph (the founder's "un colore chiaro per
 * categoria"). Each is the dominant node colour of that category so the wash
 * harmonises with the nodes sitting on it; applied at low fill-opacity.
 */
export const MACRO_CATEGORY_COLOR: Record<MacroCategory, string> = {
  concorrenza: 'var(--clay)',
  clienti: 'var(--cat-gold)',
  partner: 'var(--cat-teal)',
  investitori: 'var(--moss)',
  contesto: 'var(--plum)',
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

/** Bilingual node-type labels for the graph legend (in-project language). */
export const NODE_TYPE_LABEL: Record<GraphNodeType, { en: string; it: string }> = {
  your_startup: { en: 'Your startup', it: 'La tua startup' },
  competitor: { en: 'Competitor', it: 'Concorrente' },
  company: { en: 'Company', it: 'Azienda' },
  competitor_set: { en: 'Competitor set', it: 'Set concorrenti' },
  persona: { en: 'Persona', it: 'Persona' },
  market_segment: { en: 'Market segment', it: 'Segmento di mercato' },
  market: { en: 'Market', it: 'Mercato' },
  partner: { en: 'Partner', it: 'Partner' },
  funding_source: { en: 'Investor', it: 'Investitore' },
  technology: { en: 'Technology', it: 'Tecnologia' },
  trend: { en: 'Trend', it: 'Trend' },
  signal: { en: 'Signal', it: 'Segnale' },
  risk: { en: 'Risk', it: 'Rischio' },
  compliance: { en: 'Compliance', it: 'Compliance' },
  regulation: { en: 'Regulation', it: 'Normativa' },
  feature: { en: 'Feature', it: 'Funzionalità' },
  metric: { en: 'Metric', it: 'Metrica' },
  metrics: { en: 'Metrics', it: 'Metriche' },
  benchmark: { en: 'Benchmark', it: 'Benchmark' },
  comparison: { en: 'Comparison', it: 'Confronto' },
  research_metric: { en: 'Research metric', it: 'Metrica di ricerca' },
};

export function nodeTypeLabel(type: string, locale: string): string {
  const entry = NODE_TYPE_LABEL[type as GraphNodeType];
  if (entry) return locale === 'it' ? entry.it : entry.en;
  return type.replace(/_/g, ' ');
}

/**
 * Derived-analysis node types minted as a side effect of chat artifacts
 * (metric-grid → metrics/benchmark/research_metric; comparison-table →
 * comparison/competitor_set). Their names are dashboard/scorecard titles
 * ("7-Stage Validation Spine — Current Status", "Competitor Landscape"), NOT
 * ecosystem entities — the exact "disordinato" clutter from the 2026-06 sync.
 * Excluded from the Knowledge graph AND the unified list so both surfaces show
 * real named entities only. The underlying artifact still renders in chat.
 */
export const DERIVED_ANALYSIS_NODE_TYPES: ReadonlySet<string> = new Set([
  'metrics', 'benchmark', 'comparison', 'competitor_set', 'research_metric',
]);

export function isDerivedAnalysisNode(type: string | null | undefined): boolean {
  return !!type && DERIVED_ANALYSIS_NODE_TYPES.has(type);
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
  signal: 'var(--plum)',
  company: 'var(--sky)',
  compliance: 'var(--cat-rose)',
  regulation: 'var(--cat-rose)',
  partner: 'var(--cat-teal)',
  funding_source: 'var(--moss)',
  feature: 'var(--plum)',
  metric: 'var(--sky)',
  // Derived-analysis types (see GraphNodeType note) — no longer grey blobs.
  metrics: 'var(--sky)',
  benchmark: 'var(--sky)',
  research_metric: 'var(--sky)',
  comparison: 'var(--plum)',
  competitor_set: 'var(--clay)',
  market: 'var(--moss)',
};
