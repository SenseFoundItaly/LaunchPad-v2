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
