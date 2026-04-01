'use client';

import { useRef, useEffect } from 'react';
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

export default function KnowledgeGraph({ nodes, edges, onNodeClick, onEdgeClick }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) {return;}
    if (nodes.length === 0) {return;}

    // Stop previous simulation
    if (simulationRef.current) {simulationRef.current.stop();}

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height);

    svg.selectAll('*').remove();

    // Helper: always get string ID from source/target (D3 mutates these to objects)
    const getId = (ref: string | GraphNode | SimNode | undefined): string => {
      if (!ref) {return '';}
      if (typeof ref === 'string') {return ref;}
      return (ref as { id: string }).id || '';
    };

    // Prepare data — deep copy so D3 mutations don't affect React state
    const nodeMap: Record<string, GraphNode> = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    const simNodes: SimNode[] = nodes.map(n => ({
      id: n.id,
      name: n.name,
      node_type: n.node_type,
      summary: n.summary,
      rawData: n,
    }));

    // Process edges — calculate curvature for multi-edges
    const edgePairCount: Record<string, number> = {};
    const edgePairIndex: Record<string, number> = {};

    const validEdges = edges.filter(e => {
      const srcId = getId(e.source);
      const tgtId = getId(e.target);
      return srcId && tgtId && nodeMap[srcId] && nodeMap[tgtId];
    });

    validEdges.forEach(e => {
      const srcId = getId(e.source);
      const tgtId = getId(e.target);
      const pairKey = [srcId, tgtId].toSorted().join('_');
      edgePairCount[pairKey] = (edgePairCount[pairKey] || 0) + 1;
    });

    const simLinks: SimLink[] = validEdges.map(e => {
      const srcId = getId(e.source);
      const tgtId = getId(e.target);
      const pairKey = [srcId, tgtId].toSorted().join('_');
      const total = edgePairCount[pairKey] || 1;
      const idx = edgePairIndex[pairKey] || 0;
      edgePairIndex[pairKey] = idx + 1;

      let curvature = 0;
      if (total > 1) {
        const range = Math.min(1.2, 0.6 + total * 0.15);
        curvature = ((idx / (total - 1)) - 0.5) * range * 2;
        if (srcId > tgtId) {curvature = -curvature;}
      }

      return {
        source: srcId,
        target: tgtId,
        id: e.id,
        relation: e.relation,
        curvature,
        rawData: e,
      };
    });

    const getColor = (type: string) => NODE_COLORS[type] || '#999';

    // Force simulation (MiroFish settings)
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks)
        .id(d => d.id)
        .distance(d => {
          const srcId = typeof d.source === 'string' ? d.source : (d.source as SimNode).id;
          const tgtId = typeof d.target === 'string' ? d.target : (d.target as SimNode).id;
          const pk = [srcId, tgtId].toSorted().join('_');
          const count = edgePairCount[pk] || 1;
          return 150 + (count - 1) * 50;
        })
      )
      .force('charge', d3.forceManyBody().strength(-400))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(50))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04));

    simulationRef.current = simulation;

    const g = svg.append('g');

    // Zoom
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => { g.attr('transform', event.transform); })
    );

    // Curved edge path (MiroFish pattern)
    const getLinkPath = (d: SimLink) => {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      const sx = src.x!, sy = src.y!, tx = tgt.x!, ty = tgt.y!;

      if (d.curvature === 0) {return `M${sx},${sy} L${tx},${ty}`;}

      const dx = tx - sx, dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const offsetRatio = 0.25 + (edgePairCount[[src.id, tgt.id].toSorted().join('_')] || 1) * 0.05;
      const baseOffset = Math.max(35, dist * offsetRatio);
      const ox = -dy / dist * d.curvature * baseOffset;
      const oy = dx / dist * d.curvature * baseOffset;
      const cx = (sx + tx) / 2 + ox;
      const cy = (sy + ty) / 2 + oy;
      return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
    };

    // Edge label midpoint (MiroFish bezier formula)
    const getLinkMidpoint = (d: SimLink) => {
      const src = d.source as SimNode;
      const tgt = d.target as SimNode;
      const sx = src.x!, sy = src.y!, tx = tgt.x!, ty = tgt.y!;

      if (d.curvature === 0) {return { x: (sx + tx) / 2, y: (sy + ty) / 2 };}

      const dx = tx - sx, dy = ty - sy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const offsetRatio = 0.25 + (edgePairCount[[src.id, tgt.id].toSorted().join('_')] || 1) * 0.05;
      const baseOffset = Math.max(35, dist * offsetRatio);
      const ox = -dy / dist * d.curvature * baseOffset;
      const oy = dx / dist * d.curvature * baseOffset;
      const cx = (sx + tx) / 2 + ox;
      const cy = (sy + ty) / 2 + oy;
      return { x: 0.25 * sx + 0.5 * cx + 0.25 * tx, y: 0.25 * sy + 0.5 * cy + 0.25 * ty };
    };

    // Links group
    const linkGroup = g.append('g').attr('class', 'links');

    const link = linkGroup.selectAll<SVGPathElement, SimLink>('path')
      .data(simLinks)
      .enter().append('path')
      .attr('stroke', '#555')
      .attr('stroke-width', 1.5)
      .attr('fill', 'none')
      .attr('opacity', 0.6)
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        link.attr('stroke', '#555').attr('stroke-width', 1.5);
        d3.select(event.currentTarget as SVGPathElement).attr('stroke', '#3b82f6').attr('stroke-width', 3);
        onEdgeClick?.(d.rawData);
      });

    // Edge label backgrounds
    const linkLabelBg = linkGroup.selectAll<SVGRectElement, SimLink>('rect')
      .data(simLinks)
      .enter().append('rect')
      .attr('fill', 'rgba(24,24,27,0.9)')
      .attr('rx', 3).attr('ry', 3)
      .style('pointer-events', 'none');

    // Edge labels
    const linkLabels = linkGroup.selectAll<SVGTextElement, SimLink>('text')
      .data(simLinks)
      .enter().append('text')
      .text(d => d.relation.replace(/_/g, ' '))
      .attr('font-size', '8px')
      .attr('fill', '#888')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .style('pointer-events', 'none')
      .style('font-family', 'system-ui, sans-serif');

    // Nodes group
    const nodeGroup = g.append('g').attr('class', 'nodes');

    const node = nodeGroup.selectAll<SVGCircleElement, SimNode>('circle')
      .data(simNodes)
      .enter().append('circle')
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
          const dx = event.x - (d._dragStartX || 0);
          const dy = event.y - (d._dragStartY || 0);
          if (!d._isDragging && Math.sqrt(dx * dx + dy * dy) > 3) {
            d._isDragging = true;
            simulation.alphaTarget(0.3).restart();
          }
          if (d._isDragging) { d.fx = event.x; d.fy = event.y; }
        })
        .on('end', (_event, d) => {
          if (d._isDragging) {simulation.alphaTarget(0);}
          d.fx = null; d.fy = null; d._isDragging = false;
        })
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        // Reset all
        node.attr('stroke', (n: SimNode) => n.node_type === 'your_startup' ? '#3b82f6' : '#27272a')
          .attr('stroke-width', (n: SimNode) => n.node_type === 'your_startup' ? 3 : 2);
        link.attr('stroke', '#555').attr('stroke-width', 1.5);
        // Highlight selected + connected edges
        d3.select(event.currentTarget as SVGCircleElement).attr('stroke', '#ec4899').attr('stroke-width', 4);
        link.filter((l: SimLink) => (l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id)
          .attr('stroke', '#ec4899').attr('stroke-width', 2.5);
        onNodeClick?.(d.rawData);
      })
      .on('mouseenter', (event, d) => {
        d3.select(event.currentTarget as SVGCircleElement).attr('stroke-width', 4);
      })
      .on('mouseleave', (event, d) => {
        d3.select(event.currentTarget as SVGCircleElement)
          .attr('stroke-width', d.node_type === 'your_startup' ? 3 : 2);
      });

    // Node labels
    nodeGroup.selectAll<SVGTextElement, SimNode>('text')
      .data(simNodes)
      .enter().append('text')
      .text(d => d.name.length > 14 ? d.name.substring(0, 14) + '...' : d.name)
      .attr('font-size', '10px')
      .attr('fill', '#a1a1aa')
      .attr('font-weight', '500')
      .attr('dx', 16)
      .attr('dy', 4)
      .style('pointer-events', 'none')
      .style('font-family', 'system-ui, sans-serif');

    // Tick — update positions every frame
    simulation.on('tick', () => {
      link.attr('d', d => getLinkPath(d));

      linkLabels.each(function (d) {
        const mid = getLinkMidpoint(d);
        d3.select(this).attr('x', mid.x).attr('y', mid.y);
      });

      linkLabelBg.each(function (d, i) {
        const mid = getLinkMidpoint(d);
        const textEl = linkLabels.nodes()[i];
        if (textEl) {
          const bbox = textEl.getBBox();
          d3.select(this)
            .attr('x', mid.x - bbox.width / 2 - 3)
            .attr('y', mid.y - bbox.height / 2 - 1)
            .attr('width', bbox.width + 6)
            .attr('height', bbox.height + 2);
        }
      });

      node.attr('cx', d => d.x!).attr('cy', d => d.y!);
      nodeGroup.selectAll<SVGTextElement, SimNode>('text')
        .attr('x', d => d.x!).attr('y', d => d.y!);
    });

    // Click background to deselect
    svg.on('click', () => {
      node.attr('stroke', (d: SimNode) => d.node_type === 'your_startup' ? '#3b82f6' : '#27272a')
        .attr('stroke-width', (d: SimNode) => d.node_type === 'your_startup' ? 3 : 2);
      link.attr('stroke', '#555').attr('stroke-width', 1.5);
      onNodeClick?.(null as unknown as GraphNode);
    });

    return () => { simulation.stop(); };
  }, [nodes, edges, onNodeClick, onEdgeClick]);

  return (
    <div ref={containerRef} className="w-full h-full relative" style={{
      backgroundColor: '#0a0a0b',
      backgroundImage: 'radial-gradient(#27272a 1px, transparent 1px)',
      backgroundSize: '20px 20px',
    }}>
      {nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
          Knowledge graph will populate as you chat
        </div>
      ) : (
        <svg ref={svgRef} className="w-full h-full" />
      )}
    </div>
  );
}
