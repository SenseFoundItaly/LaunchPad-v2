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
  name: string;
  node_type: GraphNodeType;
  summary: string;
  attributes: Record<string, unknown>;
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
  persona: 'var(--accent)',
  risk: 'var(--cat-gold)',
  trend: 'var(--plum)',
  company: 'var(--sky)',
  compliance: 'var(--cat-rose)',
  regulation: 'var(--clay)',
  partner: 'var(--cat-teal)',
  funding_source: 'var(--accent)',
  feature: 'var(--plum)',
  metric: 'var(--sky)',
};
