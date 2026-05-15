'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphNode, GraphEdge } from '@/types/graph';
import { NODE_COLORS } from '@/types/graph';

interface KnowledgeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  name: string;
  node_type: string;
  summary: string;
  rawData: GraphNode;
  _dragStartX?: number;
  _dragStartY?: number;
  _isDragging?: boolean;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  relation: string;
  curvature: number;
  rawData: GraphEdge;
}

/** Cluster positions — radial layout by type around center */
const CLUSTER_ANGLES: Record<string, number> = {
  your_startup: 0, // center
  competitor: 0,
  technology: 45,
  market_segment: 90,
  persona: 135,
  risk: 180,
  trend: 225,
  company: 270,
  compliance: 315,
  regulation: 330,
  partner: 30,
  funding_source: 60,
  feature: 150,
  metric: 210,
};

export default function KnowledgeGraph({ nodes, edges, onNodeClick, onEdgeClick }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // ESC to exit fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Filter nodes/edges by hidden types
  const visibleNodes = nodes.filter(n => !hiddenTypes.has(n.node_type));
  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  const getId = (ref: string | GraphNode | SimNode | undefined): string => {
    if (!ref) return '';
    if (typeof ref === 'string') return ref;
    return (ref as { id: string }).id || '';
  };
  const visibleEdges = edges.filter(e => {
    const s = getId(e.source), t = getId(e.target);
    return visibleNodeIds.has(s) && visibleNodeIds.has(t);
  });

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (visibleNodes.length === 0) return;

    if (simulationRef.current) simulationRef.current.stop();

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const cx = width / 2, cy = height / 2;
    const clusterRadius = Math.min(width, height) * 0.3;

    const svg = d3.select(svgRef.current).attr('width', width).attr('height', height);
    svg.selectAll('*').remove();

    const nodeMap: Record<string, GraphNode> = {};
    visibleNodes.forEach(n => { nodeMap[n.id] = n; });

    const simNodes: SimNode[] = visibleNodes.map(n => ({
      id: n.id, name: n.name, node_type: n.node_type, summary: n.summary, rawData: n,
    }));

    // Edge processing
    const edgePairCount: Record<string, number> = {};
    const edgePairIndex: Record<string, number> = {};
    const validEdges = visibleEdges.filter(e => {
      const s = getId(e.source), t = getId(e.target);
      return s && t && nodeMap[s] && nodeMap[t];
    });
    validEdges.forEach(e => {
      const pk = [getId(e.source), getId(e.target)].toSorted().join('_');
      edgePairCount[pk] = (edgePairCount[pk] || 0) + 1;
    });

    const simLinks: SimLink[] = validEdges.map(e => {
      const s = getId(e.source), t = getId(e.target);
      const pk = [s, t].toSorted().join('_');
      const total = edgePairCount[pk] || 1;
      const idx = edgePairIndex[pk] || 0;
      edgePairIndex[pk] = idx + 1;
      let curvature = 0;
      if (total > 1) {
        const range = Math.min(1.2, 0.6 + total * 0.15);
        curvature = ((idx / (total - 1)) - 0.5) * range * 2;
        if (s > t) curvature = -curvature;
      }
      return { source: s, target: t, id: e.id, relation: e.relation, curvature, rawData: e };
    });

    const getColor = (type: string) => NODE_COLORS[type] || '#999';

    // Cluster targets
    const clusterX = (type: string) => {
      if (type === 'your_startup') return cx;
      const angle = (CLUSTER_ANGLES[type] || 0) * (Math.PI / 180);
      return cx + Math.cos(angle) * clusterRadius;
    };
    const clusterY = (type: string) => {
      if (type === 'your_startup') return cy;
      const angle = (CLUSTER_ANGLES[type] || 0) * (Math.PI / 180);
      return cy + Math.sin(angle) * clusterRadius;
    };

    // Simulation with clustering forces
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(120))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('collide', d3.forceCollide(40))
      .force('clusterX', d3.forceX<SimNode>(d => clusterX(d.node_type)).strength(0.08))
      .force('clusterY', d3.forceY<SimNode>(d => clusterY(d.node_type)).strength(0.08));

    simulationRef.current = simulation;

    const g = svg.append('g');
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => { g.attr('transform', event.transform); })
    );

    const getLinkPath = (d: SimLink) => {
      const src = d.source as SimNode, tgt = d.target as SimNode;
      const sx = src.x!, sy = src.y!, tx = tgt.x!, ty = tgt.y!;
      if (d.curvature === 0) return `M${sx},${sy} L${tx},${ty}`;
      const dx = tx - sx, dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = Math.max(35, dist * 0.25);
      const ox = -dy / dist * d.curvature * off;
      const oy = dx / dist * d.curvature * off;
      return `M${sx},${sy} Q${(sx + tx) / 2 + ox},${(sy + ty) / 2 + oy} ${tx},${ty}`;
    };

    const getLinkMid = (d: SimLink) => {
      const src = d.source as SimNode, tgt = d.target as SimNode;
      const sx = src.x!, sy = src.y!, tx = tgt.x!, ty = tgt.y!;
      if (d.curvature === 0) return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
      const dx = tx - sx, dy = ty - sy, dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = Math.max(35, dist * 0.25);
      const ox = -dy / dist * d.curvature * off, oy = dx / dist * d.curvature * off;
      const qx = (sx + tx) / 2 + ox, qy = (sy + ty) / 2 + oy;
      return { x: 0.25 * sx + 0.5 * qx + 0.25 * tx, y: 0.25 * sy + 0.5 * qy + 0.25 * ty };
    };

    // Links
    const linkGroup = g.append('g');
    const link = linkGroup.selectAll<SVGPathElement, SimLink>('path')
      .data(simLinks).enter().append('path')
      .attr('stroke', '#444').attr('stroke-width', 1.5).attr('fill', 'none').attr('opacity', 0.4)
      .style('cursor', 'pointer');

    // Edge labels — hidden by default, shown on hover
    const linkLabelGroup = linkGroup.selectAll<SVGGElement, SimLink>('g.label')
      .data(simLinks).enter().append('g').attr('class', 'label').style('opacity', 0);

    linkLabelGroup.append('rect').attr('fill', 'rgba(24,24,27,0.9)').attr('rx', 3).attr('ry', 3);
    linkLabelGroup.append('text')
      .text(d => d.relation.replace(/_/g, ' '))
      .attr('font-size', '8px').attr('fill', '#888').attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .style('font-family', 'system-ui');

    // Show label on link hover
    link.on('mouseenter', function (_e, d) {
      const idx = simLinks.indexOf(d);
      d3.select(linkLabelGroup.nodes()[idx]).style('opacity', 1);
      d3.select(this).attr('stroke', '#666').attr('stroke-width', 2.5).attr('opacity', 0.8);
    }).on('mouseleave', function (_e, d) {
      const idx = simLinks.indexOf(d);
      d3.select(linkLabelGroup.nodes()[idx]).style('opacity', 0);
      d3.select(this).attr('stroke', '#444').attr('stroke-width', 1.5).attr('opacity', 0.4);
    }).on('click', (event, d) => {
      event.stopPropagation();
      onEdgeClick?.(d.rawData);
    });

    // Nodes
    const nodeGroup = g.append('g');
    const node = nodeGroup.selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes).enter().append('circle')
      .attr('r', d => d.node_type === 'your_startup' ? 14 : 10)
      .attr('fill', d => getColor(d.node_type))
      .attr('stroke', d => d.node_type === 'your_startup' ? '#3b82f6' : '#27272a')
      .attr('stroke-width', d => d.node_type === 'your_startup' ? 3 : 2)
      .style('cursor', 'pointer')
      .style('filter', d => d.node_type === 'your_startup' ? 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' : 'none')
      .call(d3.drag<SVGCircleElement, SimNode>()
        .on('start', (event, d) => {
          d.fx = d.x; d.fy = d.y;
          d._dragStartX = event.x; d._dragStartY = event.y; d._isDragging = false;
        })
        .on('drag', (event, d) => {
          if (!d._isDragging && Math.sqrt((event.x - (d._dragStartX || 0)) ** 2 + (event.y - (d._dragStartY || 0)) ** 2) > 3) {
            d._isDragging = true;
            simulation.alphaTarget(0.3).restart();
          }
          if (d._isDragging) { d.fx = event.x; d.fy = event.y; }
        })
        .on('end', (_e, d) => {
          if (d._isDragging) simulation.alphaTarget(0);
          d.fx = null; d.fy = null; d._isDragging = false;
        })
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNodeId(d.id);
        // Dim non-connected, highlight connected
        const connectedIds = new Set<string>();
        connectedIds.add(d.id);
        simLinks.forEach(l => {
          const s = (l.source as SimNode).id, t = (l.target as SimNode).id;
          if (s === d.id) connectedIds.add(t);
          if (t === d.id) connectedIds.add(s);
        });
        node.attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.15);
        nodeGroup.selectAll<SVGTextElement, SimNode>('text').attr('opacity', n => connectedIds.has(n.id) ? 1 : 0.15);
        link.attr('opacity', l => ((l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id) ? 0.8 : 0.05)
          .attr('stroke', l => ((l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id) ? '#ec4899' : '#444');
        // Show labels for connected edges
        linkLabelGroup.style('opacity', (_l, i) => {
          const sl = simLinks[i];
          return ((sl.source as SimNode).id === d.id || (sl.target as SimNode).id === d.id) ? 1 : 0;
        });
        onNodeClick?.(d.rawData);
      });

    // Node labels
    nodeGroup.selectAll<SVGTextElement, SimNode>('text')
      .data(simNodes).enter().append('text')
      .text(d => d.name.length > 18 ? d.name.substring(0, 18) + '..' : d.name)
      .attr('font-size', '10px').attr('fill', '#a1a1aa').attr('font-weight', '500')
      .attr('dx', 16).attr('dy', 4)
      .style('pointer-events', 'none').style('font-family', 'system-ui');

    // Search highlighting
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      node.attr('opacity', d => d.name.toLowerCase().includes(q) ? 1 : 0.1);
      nodeGroup.selectAll<SVGTextElement, SimNode>('text')
        .attr('opacity', d => d.name.toLowerCase().includes(q) ? 1 : 0.1);
    }

    // Tick
    simulation.on('tick', () => {
      link.attr('d', d => getLinkPath(d));
      linkLabelGroup.each(function (d) {
        const mid = getLinkMid(d);
        const textEl = d3.select(this).select('text');
        textEl.attr('x', mid.x).attr('y', mid.y);
        const bbox = (textEl.node() as SVGTextElement)?.getBBox();
        if (bbox) {
          d3.select(this).select('rect')
            .attr('x', mid.x - bbox.width / 2 - 3).attr('y', mid.y - bbox.height / 2 - 1)
            .attr('width', bbox.width + 6).attr('height', bbox.height + 2);
        }
      });
      node.attr('cx', d => d.x!).attr('cy', d => d.y!);
      nodeGroup.selectAll<SVGTextElement, SimNode>('text').attr('x', d => d.x!).attr('y', d => d.y!);
    });

    // Click background to reset
    svg.on('click', () => {
      setSelectedNodeId(null);
      node.attr('opacity', 1);
      nodeGroup.selectAll<SVGTextElement, SimNode>('text').attr('opacity', 1);
      link.attr('stroke', '#444').attr('stroke-width', 1.5).attr('opacity', 0.4);
      linkLabelGroup.style('opacity', 0);
      onNodeClick?.(null as unknown as GraphNode);
    });

    return () => { simulation.stop(); };
  }, [visibleNodes, visibleEdges, onNodeClick, onEdgeClick, searchQuery]);

  // Import legend here to avoid circular — pass from parent instead
  const GraphLegend = require('./GraphLegend').default;

  const graphContent = (
    <div ref={containerRef} className={`w-full h-full relative ${isFullscreen ? 'fixed inset-0 z-50' : ''}`} style={{
      backgroundColor: '#0a0a0b',
      backgroundImage: 'radial-gradient(#27272a 1px, transparent 1px)',
      backgroundSize: '20px 20px',
    }}>
      {/* Controls bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 z-10">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search nodes..."
          className="px-3 py-1.5 bg-paper/80 backdrop-blur-sm border border-line rounded-lg text-xs text-ink-3 placeholder-ink-6 outline-none focus:border-ink-6 w-48"
        />
        <div className="flex-1" />
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          className="px-2 py-1.5 bg-paper/80 backdrop-blur-sm border border-line rounded-lg text-xs text-ink-4 hover:text-ink-2 transition-colors"
        >
          {isFullscreen ? 'Exit' : 'Expand'}
        </button>
        {isFullscreen && (
          <button
            onClick={() => setIsFullscreen(false)}
            className="px-2 py-1.5 bg-paper/80 backdrop-blur-sm border border-line rounded-lg text-xs text-ink-4 hover:text-ink-2"
          >
            ESC
          </button>
        )}
      </div>

      {nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-ink-5 text-sm">
          Knowledge graph will populate as you chat
        </div>
      ) : (
        <svg ref={svgRef} className="w-full h-full" />
      )}

      <GraphLegend
        activeTypes={nodes.map(n => n.node_type)}
        hiddenTypes={hiddenTypes}
        onToggleType={toggleType}
        nodeCount={visibleNodes.length}
        edgeCount={visibleEdges.length}
      />
    </div>
  );

  return graphContent;
}
