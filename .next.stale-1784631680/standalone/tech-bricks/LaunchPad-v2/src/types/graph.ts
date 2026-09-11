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
  // 12-satellite taxonomy (2026-07 mockup): named ecosystem roles that used to
  // drown in "contesto". Minted by chat entity-cards, upload extraction, and
  // the canvas → business-essentials sync.
  | 'supplier'
  | 'hr_collaborator'
  | 'brand_asset'
  | 'gtm_strategy'
  | 'business_essential'
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
 * 2026-06 weekly sync, expanded 2026-07 to the 12-satellite hub-and-spoke of
 * the mockup: every node type collapses into one of 12 founder-legible
 * ecosystem roles arranged clockwise around the startup root. The old
 * catch-all "contesto" is gone — its former residents now have real homes
 * (technology → trend_tech, trend/signal → trend_mercato, risk/compliance/
 * regulation → business_essentials, product analysis types → prodotto).
 * your_startup is the root and has no macro-category (it sits at center).
 */
export type MacroCategory =
  | 'fornitori'
  | 'clienti'
  | 'hr_collabs'
  | 'concorrenza'
  | 'business_essentials'
  | 'prodotto'
  | 'branding'
  | 'partner'
  | 'trend_tech'
  | 'investitori'
  | 'gtm'
  | 'trend_mercato';

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
  supplier: 'fornitori',
  hr_collaborator: 'hr_collabs',
  brand_asset: 'branding',
  gtm_strategy: 'gtm',
  business_essential: 'business_essentials',
  technology: 'trend_tech',
  trend: 'trend_mercato',
  signal: 'trend_mercato',
  risk: 'business_essentials',
  compliance: 'business_essentials',
  regulation: 'business_essentials',
  feature: 'prodotto',
  metric: 'prodotto',
  metrics: 'prodotto',
  benchmark: 'prodotto',
  comparison: 'prodotto',
  research_metric: 'prodotto',
};

/**
 * Legacy node_type strings that live in prod rows but were never part of
 * GraphNodeType (persistEntityCard's old 'entity' default, chat's loose
 * 'customer'/'investor'). Mapped so old rows land in a real satellite instead
 * of the fallback.
 */
export const LEGACY_TYPE_CATEGORY: Record<string, MacroCategory> = {
  customer: 'clienti',
  investor: 'investitori',
  entity: 'business_essentials',
};

/**
 * One tint per macro-category — the soft background wash that groups each
 * ecosystem region on the graph (the founder's "un colore chiaro per
 * categoria"). Each is the dominant node colour of that category so the wash
 * harmonises with the nodes sitting on it; applied at low fill-opacity.
 */
export const MACRO_CATEGORY_COLOR: Record<MacroCategory, string> = {
  fornitori: 'var(--cat-copper)',
  clienti: 'var(--cat-gold)',
  hr_collabs: 'var(--cat-olive)',
  concorrenza: 'var(--clay)',
  business_essentials: 'var(--cat-slate)',
  prodotto: 'var(--cat-indigo)',
  branding: 'var(--cat-rose)',
  partner: 'var(--cat-teal)',
  trend_tech: 'var(--sky)',
  investitori: 'var(--moss)',
  gtm: 'var(--cat-violet)',
  trend_mercato: 'var(--plum)',
};

/** Fixed wedge order (mockup clockwise, starting at the top) + bilingual labels. */
export const MACRO_CATEGORY_ORDER: MacroCategory[] = [
  'fornitori', 'clienti', 'hr_collabs', 'concorrenza', 'business_essentials', 'prodotto',
  'branding', 'partner', 'trend_tech', 'investitori', 'gtm', 'trend_mercato',
];

export const MACRO_CATEGORY_LABEL: Record<MacroCategory, { en: string; it: string }> = {
  fornitori: { en: 'Suppliers', it: 'Fornitori' },
  clienti: { en: 'Customers', it: 'Clienti' },
  hr_collabs: { en: 'HR & Collaborators', it: 'HR & Collaboratori' },
  concorrenza: { en: 'Competition', it: 'Concorrenza' },
  business_essentials: { en: 'Business essentials', it: 'Business essentials' },
  prodotto: { en: 'Product', it: 'Prodotto' },
  branding: { en: 'Branding', it: 'Branding' },
  partner: { en: 'Partners', it: 'Partner' },
  trend_tech: { en: 'Tech trends', it: 'Trend tech' },
  investitori: { en: 'Investors', it: 'Investitori' },
  gtm: { en: 'Go-to-market', it: 'Go-to-market' },
  trend_mercato: { en: 'Market trends', it: 'Trend di mercato' },
};

export function macroCategoryFor(type: string): MacroCategory | null {
  const direct = MACRO_CATEGORY[type as GraphNodeType];
  if (direct !== undefined) return direct; // null for your_startup (root, no wedge)
  return LEGACY_TYPE_CATEGORY[type] ?? 'business_essentials';
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
  supplier: { en: 'Supplier', it: 'Fornitore' },
  hr_collaborator: { en: 'Collaborator', it: 'Collaboratore' },
  brand_asset: { en: 'Brand asset', it: 'Asset di brand' },
  gtm_strategy: { en: 'GTM strategy', it: 'Strategia GTM' },
  business_essential: { en: 'Business essential', it: 'Business essential' },
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
  // sky (not cat-teal) so technology dots don't collide with partner in the
  // legend — and match their trend_tech wedge.
  technology: 'var(--sky)',
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
  supplier: 'var(--cat-copper)',
  hr_collaborator: 'var(--cat-olive)',
  brand_asset: 'var(--cat-rose)',
  gtm_strategy: 'var(--cat-violet)',
  business_essential: 'var(--cat-slate)',
  // Product-analysis types — indigo, matching their prodotto wedge.
  feature: 'var(--cat-indigo)',
  metric: 'var(--cat-indigo)',
  metrics: 'var(--cat-indigo)',
  benchmark: 'var(--cat-indigo)',
  research_metric: 'var(--cat-indigo)',
  comparison: 'var(--cat-indigo)',
  competitor_set: 'var(--clay)',
  market: 'var(--moss)',
};
