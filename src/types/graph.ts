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
  your_startup: '#ffffff',
  competitor: '#ef4444',     // red
  technology: '#06b6d4',     // cyan
  market_segment: '#22c55e', // green
  persona: '#f59e0b',        // amber
  risk: '#f97316',           // orange
  trend: '#a855f7',          // purple
  company: '#3b82f6',        // blue
  compliance: '#ec4899',     // pink
  regulation: '#e11d48',     // rose
  partner: '#14b8a6',        // teal
  funding_source: '#84cc16', // lime
  feature: '#8b5cf6',        // violet
  metric: '#0ea5e9',         // sky
};
