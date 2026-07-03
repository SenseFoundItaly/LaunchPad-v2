'use client';

import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import type { GraphNode, GraphEdge, MacroCategory } from '@/types/graph';
import { NODE_COLORS, MACRO_CATEGORY_ORDER, MACRO_CATEGORY_LABEL, MACRO_CATEGORY_COLOR, macroCategoryFor } from '@/types/graph';
import NodeDetailPanel, { type NodeNeighbor, type TimelineEntry } from './NodeDetailPanel';
import { useLocale, useT } from '@/components/providers/LocaleProvider';

interface KnowledgeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (node: GraphNode) => void;
  onEdgeClick?: (edge: GraphEdge) => void;
  /** Called when a PENDING node is applied from the detail drawer — applies it to intelligence. */
  onApplyNode?: (node: GraphNode) => void;
  /** Called when a PENDING node is dismissed from the detail drawer — rejects it (free). */
  onDismissNode?: (node: GraphNode) => void;
  /** Persist an edited name/summary for a node (from the detail drawer). */
  onSaveNode?: (node: GraphNode, patch: { name?: string; summary?: string }) => Promise<void> | void;
  /** Remove one dated move from a node's timeline (from the detail drawer). */
  onDeleteTimelineEntry?: (node: GraphNode, entry: TimelineEntry) => Promise<void> | void;
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

// Layout note: nodes cluster by MACRO-CATEGORY (the 2026-06 "matrioska"), one
// tinted region per ecosystem role. The per-category ANGLE is computed inside
// the effect from the categories actually present, so absent roles don't leave
// the graph lopsided — see catAngleDeg below.

/** Normalize an edge endpoint (string id, raw node, or sim node) to its id.
 * Module-scope + pure so it has a stable identity across renders. */
const getId = (ref: string | GraphNode | SimNode | undefined): string => {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return (ref as { id: string }).id || '';
};

export default function KnowledgeGraph({ nodes, edges, onNodeClick, onEdgeClick, onApplyNode, onDismissNode, onSaveNode, onDeleteTimelineEntry }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // The node whose detail drawer is open (ANY node — applied or pending). The
  // drawer replaced the old pending-only floating popover so there is a single
  // detail surface for the graph. Set on node click; cleared on background click.
  const [detailNode, setDetailNode] = useState<GraphNode | null>(null);
  // Active locale → which macro-category region label to draw (Concorrenza vs
  // Competition). Inside a project this resolves to the project's language.
  const locale = useLocale();
  const t = useT();

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

  // Filter nodes/edges by hidden types. MEMOIZED so a re-render caused ONLY by
  // selection/detail state (clicking a node sets selectedNodeId + detailNode)
  // keeps the SAME array references. The heavy D3 effect below lists these in its
  // deps; without memoization every click produced fresh arrays → the effect
  // re-ran svg.selectAll('*').remove() and rebuilt the whole force simulation,
  // flashing the graph and resetting node positions. Recomputes only when the
  // data (nodes/edges) or the type filter actually changes — so a real refetch
  // still rebuilds, but a click does not.
  const visibleNodes = useMemo(
    () => nodes.filter(n => !hiddenTypes.has(n.node_type)),
    [nodes, hiddenTypes],
  );
  const visibleEdges = useMemo(() => {
    const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
    return edges.filter(e => {
      // Virtual root→node edges are a layout/UX artefact ("belongs to the
      // project"), NOT real relationships. Drawing + simulating them collapsed
      // every unconnected node into a radial star around the root and defeated
      // the category clustering. Exclude them here so the graph lays out purely
      // by ecosystem region; the NodeDetailPanel still derives "belongs to" from
      // the raw `edges` prop, so that context is not lost.
      if (e.virtual) return false;
      const s = getId(e.source), t = getId(e.target);
      return visibleNodeIds.has(s) && visibleNodeIds.has(t);
    });
  }, [edges, visibleNodes]);

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

    const getColor = (type: string) => NODE_COLORS[type] || 'var(--ink-5)';

    // Distribute the categories that ACTUALLY have nodes evenly around the
    // circle (starting at the top, clockwise) instead of using fixed global
    // wedges. With fixed wedges an absent category (e.g. no investors) left a
    // gap and shoved the whole graph off-centre; even distribution keeps the
    // startup root balanced in the middle whatever mix of categories exists.
    const presentCats = MACRO_CATEGORY_ORDER.filter(cat =>
      simNodes.some(n => n.node_type !== 'your_startup' && macroCategoryFor(n.node_type) === cat),
    );
    const catAngleDeg = new Map<MacroCategory, number>(
      presentCats.map((cat, i) => [cat, -90 + (360 / Math.max(1, presentCats.length)) * i]),
    );
    const angleForNodeType = (type: string): number => {
      const cat = macroCategoryFor(type);
      return cat && catAngleDeg.has(cat) ? catAngleDeg.get(cat)! : -90;
    };

    // Cluster targets — by macro-category (startup pinned at centre).
    const clusterX = (type: string) => {
      if (type === 'your_startup') return cx;
      const angle = angleForNodeType(type) * (Math.PI / 180);
      return cx + Math.cos(angle) * clusterRadius;
    };
    const clusterY = (type: string) => {
      if (type === 'your_startup') return cy;
      const angle = angleForNodeType(type) * (Math.PI / 180);
      return cy + Math.sin(angle) * clusterRadius;
    };

    // Simulation with STRONG clustering forces. The category pull (0.35) now
    // dominates the (real-edge-only) link + charge forces, so same-category
    // nodes sit together in their wedge and the graph reads as grouped regions
    // rather than one radial scatter. Charge is softened and collide tightened
    // so a category with many nodes spreads into a readable disk instead of a
    // line. your_startup is pinned to the exact centre so it anchors the middle.
    const simulation = d3.forceSimulation<SimNode>(simNodes)
      .force('link', d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(90).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-160))
      .force('collide', d3.forceCollide(30))
      .force('clusterX', d3.forceX<SimNode>(d => clusterX(d.node_type)).strength(d => d.node_type === 'your_startup' ? 1 : 0.35))
      .force('clusterY', d3.forceY<SimNode>(d => clusterY(d.node_type)).strength(d => d.node_type === 'your_startup' ? 1 : 0.35));

    simulationRef.current = simulation;

    const g = svg.append('g');
    svg.call(d3.zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [width, height]])
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => { g.attr('transform', event.transform); })
    );

    // Macro-category REGIONS — a soft tinted background hull per ecosystem role
    // (Concorrenza / Clienti / Partner / Investitori / Contesto), each in the
    // category's colour at low opacity with its label floated above. This is the
    // founder's "un colore chiaro per categoria" + "gruppi per categoria vicini":
    // the wash makes the grouping legible even when a project has no real edges.
    // Drawn FIRST so it sits behind links + nodes; positions recomputed on tick
    // because the cluster force settles the node coordinates over time.
    const hullGroup = g.append('g').attr('pointer-events', 'none');
    // presentCats is computed above (drives the cluster angles too).

    /** Rounded, padded blob path around a category's node points. 1 point → a
     *  circle; 2 → a capsule-ish circle; ≥3 → a Catmull-Rom-smoothed convex hull
     *  expanded outward from its centroid so nodes sit comfortably inside. */
    const HULL_PAD = 34;
    const smoothClosed = d3.line().curve(d3.curveCatmullRomClosed.alpha(0.6));
    const circlePath = (x: number, y: number, r: number) =>
      `M${x - r},${y}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0`;
    const regionPath = (pts: [number, number][]): string => {
      if (pts.length === 0) return '';
      if (pts.length === 1) return circlePath(pts[0][0], pts[0][1], HULL_PAD + 6);
      if (pts.length === 2) {
        const mx = (pts[0][0] + pts[1][0]) / 2, my = (pts[0][1] + pts[1][1]) / 2;
        const r = Math.hypot(pts[0][0] - mx, pts[0][1] - my) + HULL_PAD + 6;
        return circlePath(mx, my, r);
      }
      const hull = d3.polygonHull(pts);
      if (!hull) return '';
      const hx = d3.mean(hull, p => p[0]) ?? 0, hy = d3.mean(hull, p => p[1]) ?? 0;
      const expanded = hull.map(([x, y]) => {
        const dx = x - hx, dy = y - hy, d = Math.hypot(dx, dy) || 1;
        return [x + (dx / d) * HULL_PAD, y + (dy / d) * HULL_PAD] as [number, number];
      });
      return smoothClosed(expanded) ?? '';
    };

    const regions = hullGroup.selectAll<SVGGElement, MacroCategory>('g.region')
      .data(presentCats).enter().append('g').attr('class', 'region');
    regions.append('path')
      .attr('fill', d => MACRO_CATEGORY_COLOR[d])
      .attr('fill-opacity', 0.07)
      .attr('stroke', d => MACRO_CATEGORY_COLOR[d])
      .attr('stroke-opacity', 0.22)
      .attr('stroke-width', 1);
    regions.append('text')
      .text(d => MACRO_CATEGORY_LABEL[d][locale === 'it' ? 'it' : 'en'].toUpperCase())
      .attr('text-anchor', 'middle')
      .attr('font-size', '10.5px')
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.09em')
      .attr('fill', d => MACRO_CATEGORY_COLOR[d])
      .attr('fill-opacity', 0.85)
      .style('font-family', 'system-ui');

    /** Recompute every region hull + label from the current node positions. */
    const updateRegions = () => {
      regions.each(function (cat) {
        const pts = simNodes
          .filter(n => n.node_type !== 'your_startup' && macroCategoryFor(n.node_type) === cat && n.x != null && n.y != null)
          .map(n => [n.x as number, n.y as number] as [number, number]);
        const sel = d3.select(this);
        sel.select('path').attr('d', regionPath(pts));
        if (pts.length > 0) {
          const lx = d3.mean(pts, p => p[0]) ?? 0;
          const minY = d3.min(pts, p => p[1]) ?? 0;
          sel.select('text').attr('x', lx).attr('y', minY - HULL_PAD - 4);
        }
      });
    };

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
      .attr('stroke', 'var(--line)').attr('stroke-width', 1.5).attr('fill', 'none').attr('opacity', 0.4)
      .style('cursor', 'pointer');

    // Edge labels — hidden by default, shown on hover
    const linkLabelGroup = linkGroup.selectAll<SVGGElement, SimLink>('g.label')
      .data(simLinks).enter().append('g').attr('class', 'label').style('opacity', 0);

    linkLabelGroup.append('rect').attr('fill', 'rgba(24,24,27,0.9)').attr('rx', 3).attr('ry', 3);
    linkLabelGroup.append('text')
      .text(d => d.relation.replace(/_/g, ' '))
      .attr('font-size', '8px').attr('fill', 'var(--ink-4)').attr('text-anchor', 'middle').attr('dominant-baseline', 'middle')
      .style('font-family', 'system-ui');

    // Show label on link hover
    link.on('mouseenter', function (_e, d) {
      const idx = simLinks.indexOf(d);
      d3.select(linkLabelGroup.nodes()[idx]).style('opacity', 1);
      d3.select(this).attr('stroke', 'var(--ink-4)').attr('stroke-width', 2.5).attr('opacity', 0.8);
    }).on('mouseleave', function (_e, d) {
      const idx = simLinks.indexOf(d);
      d3.select(linkLabelGroup.nodes()[idx]).style('opacity', 0);
      d3.select(this).attr('stroke', 'var(--line)').attr('stroke-width', 1.5).attr('opacity', 0.4);
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
      // Pending proposals render dashed + translucent (accent ring) so they
      // read as "not solid yet"; applied nodes are unchanged.
      .attr('stroke', d => d.rawData.reviewed_state === 'pending' ? 'var(--accent)' : d.node_type === 'your_startup' ? 'var(--sky)' : 'var(--line)')
      .attr('stroke-width', d => d.node_type === 'your_startup' ? 3 : 2)
      .attr('stroke-dasharray', d => d.rawData.reviewed_state === 'pending' ? '3,2' : null)
      .style('fill-opacity', d => d.rawData.reviewed_state === 'pending' ? 0.4 : 1)
      .style('cursor', 'pointer')
      .style('filter', d => d.node_type === 'your_startup' ? 'drop-shadow(0 0 8px var(--ink-5))' : 'none')
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
          .attr('stroke', l => ((l.source as SimNode).id === d.id || (l.target as SimNode).id === d.id) ? 'var(--accent)' : 'var(--line)');
        // Show labels for connected edges
        linkLabelGroup.style('opacity', (_l, i) => {
          const sl = simLinks[i];
          return ((sl.source as SimNode).id === d.id || (sl.target as SimNode).id === d.id) ? 1 : 0;
        });
        onNodeClick?.(d.rawData);
        // Clicking ANY node opens the right-hand detail drawer. Only CALL the
        // stable setter here — never READ `detailNode` inside this D3 closure (it
        // would be stale), and it is NOT in this effect's deps.
        setDetailNode(d.rawData);
      });

    // Hover cue — pending nodes invite a review; others show the name.
    node.append('title').text(d =>
      d.rawData.reviewed_state === 'pending'
        ? t('knowledge.graph-pending-hint')
        : d.name,
    );

    // Node labels
    nodeGroup.selectAll<SVGTextElement, SimNode>('text')
      .data(simNodes).enter().append('text')
      .text(d => d.name.length > 18 ? d.name.substring(0, 18) + '..' : d.name)
      .attr('font-size', '10px').attr('fill', 'var(--ink-4)').attr('font-weight', '500')
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
      updateRegions();
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
      setDetailNode(null);
      node.attr('opacity', 1);
      nodeGroup.selectAll<SVGTextElement, SimNode>('text').attr('opacity', 1);
      link.attr('stroke', 'var(--line)').attr('stroke-width', 1.5).attr('opacity', 0.4);
      linkLabelGroup.style('opacity', 0);
      onNodeClick?.(null as unknown as GraphNode);
    });

    return () => { simulation.stop(); };
  }, [visibleNodes, visibleEdges, onNodeClick, onEdgeClick, searchQuery, locale, t]);

  // Import legend here to avoid circular — pass from parent instead
  const GraphLegend = require('./GraphLegend').default;

  // Re-resolve the open node from the latest props each render so the drawer
  // reflects live data after a refetch (e.g. attributes/sources filled in), not
  // the object captured at click time. Falls back to the captured node if it has
  // dropped out of the graph.
  const liveDetailNode = detailNode
    ? (nodes.find(n => n.id === detailNode.id) ?? detailNode)
    : null;

  // One-hop neighbors of the open node, derived from the RAW edge list (props),
  // not the D3 simLinks — simLinks mutate source/target into node objects and
  // are scoped to the effect. Virtual root→node edges count as real relations
  // ("belongs to" the project), so the founder always sees what a node hangs off.
  const detailNeighbors: NodeNeighbor[] = (() => {
    if (!liveDetailNode) return [];
    const byId = new Map(nodes.map(n => [n.id, n]));
    const seen = new Set<string>();
    const out: NodeNeighbor[] = [];
    for (const e of edges) {
      const s = getId(e.source), t = getId(e.target);
      let otherId: string | null = null;
      let direction: 'out' | 'in' = 'out';
      if (s === liveDetailNode.id) { otherId = t; direction = 'out'; }
      else if (t === liveDetailNode.id) { otherId = s; direction = 'in'; }
      if (!otherId) continue;
      const other = byId.get(otherId);
      if (!other) continue;
      const dedupeKey = `${otherId}|${e.relation}|${direction}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({ node: other, relation: e.relation, direction });
    }
    return out;
  })();

  // Apply/Dismiss from the drawer mutate the node server-side and the parent
  // refetches the graph; the open node object would go stale, so close the drawer.
  const handleApply = onApplyNode
    ? (n: GraphNode) => { onApplyNode(n); setDetailNode(null); }
    : undefined;
  const handleDismiss = onDismissNode
    ? (n: GraphNode) => { onDismissNode(n); setDetailNode(null); }
    : undefined;

  const graphContent = (
    <div ref={containerRef} className={`w-full h-full relative ${isFullscreen ? 'fixed inset-0 z-50' : ''}`} style={{
      backgroundColor: 'var(--paper)',
      backgroundImage: 'radial-gradient(var(--line) 1px, transparent 1px)',
      backgroundSize: '20px 20px',
    }}>
      {/* Controls bar — clustered on the LEFT so it never collides with the
          page's Graph/List toggle in the top-right corner. Search + Expand sit
          together; the fullscreen Expand becomes an icon button to stay compact. */}
      <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('knowledge.graph-search')}
          className="px-3 py-1.5 bg-paper/80 backdrop-blur-sm border border-line rounded-lg text-xs text-ink-3 placeholder-ink-6 outline-none focus:border-ink-6 w-44"
        />
        <button
          onClick={() => setIsFullscreen(!isFullscreen)}
          title={isFullscreen ? t('knowledge.graph-exit') : t('knowledge.graph-expand')}
          aria-label={isFullscreen ? t('knowledge.graph-exit') : t('knowledge.graph-expand')}
          className="flex items-center justify-center w-8 h-8 bg-paper/80 backdrop-blur-sm border border-line rounded-lg text-ink-4 hover:text-ink-2 transition-colors"
        >
          {isFullscreen ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M6 2H2v4M14 6V2h-4M10 14h4v-4M2 10v4h4" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M10 2h4v4M14 2l-5 5M6 14H2v-4M2 14l5-5" /></svg>
          )}
        </button>
      </div>

      {nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-ink-5 text-sm">
          {t('knowledge.graph-will-populate')}
        </div>
      ) : (
        <svg ref={svgRef} className="w-full h-full" />
      )}

      {/* Node detail drawer for the clicked node (applied OR pending). Rendered
          as a SIBLING of <svg> (NOT inside it): the D3 effect does
          svg.selectAll('*').remove(), which would wipe anything mounted within
          the SVG. The drawer carries the pending Apply/Dismiss review actions. */}
      <NodeDetailPanel
        node={liveDetailNode}
        neighbors={detailNeighbors}
        onClose={() => setDetailNode(null)}
        onSelectNeighbor={(n) => setDetailNode(n)}
        onApply={handleApply}
        onDismiss={handleDismiss}
        onSaveEdit={onSaveNode}
        onDeleteTimelineEntry={onDeleteTimelineEntry}
      />

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
