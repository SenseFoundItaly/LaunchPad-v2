'use client';

/**
 * Intelligence Graph — ported from screen-graph.jsx.
 *
 * Full-canvas knowledge graph. Replaces the old skill-scoring radar which
 * moved to /readiness in the prior commit.
 *
 * Three-column layout:
 *   - 220px left: filters (node types with counts, edge types, recent nodes)
 *   - flex center: SVG canvas (static polar layout — self node at center,
 *                  others radiate by node_type sector)
 *   - 320px right: NodeDetail for selected node (summary, attributes, edges)
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I, IconBtn } from '@/components/design/primitives';

interface GraphNode {
  id: string;
  project_id: string;
  name: string;
  node_type: string;
  summary: string | null;
  attributes: Record<string, unknown>;
  created_at: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: string;
  label: string | null;
  weight: number;
}

interface GraphResponse {
  success: boolean;
  data?: { nodes: GraphNode[]; edges: GraphEdge[] };
}

const TYPE_COLOR: Record<string, string> = {
  your_startup: 'var(--ink)',
  competitor: 'var(--clay)',
  market_segment: 'var(--sky)',
  technology: 'var(--moss)',
  trend: 'var(--moss)',
  risk: 'oklch(0.60 0.14 20)',
  persona: 'var(--plum)',
  partner: 'var(--sky)',
  ip_alert: 'var(--accent)',
  insight: 'var(--accent)',
  feature: 'var(--ink-3)',
  metric: 'var(--ink-4)',
  company: 'var(--ink-3)',
  compliance: 'oklch(0.55 0.1 40)',
  regulation: 'oklch(0.55 0.1 40)',
  funding_source: 'var(--sky)',
  investor: 'oklch(0.78 0.15 80)',
};

const TYPE_LABEL: Record<string, string> = {
  your_startup: 'you',
  competitor: 'competitors',
  market_segment: 'markets',
  technology: 'tech',
  trend: 'trends',
  risk: 'risks',
  persona: 'personas',
  partner: 'partners',
  ip_alert: 'IP alerts',
  insight: 'insights',
  investor: 'investors',
};

export default function IntelligenceGraphPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/graph/${projectId}`);
      const body: GraphResponse = await res.json();
      if (body.success && body.data) {
        setNodes(body.data.nodes || []);
        setEdges(body.data.edges || []);
      }
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Type counts for filter panel
  const typeCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const n of nodes) acc[n.node_type] = (acc[n.node_type] || 0) + 1;
    return acc;
  }, [nodes]);

  // Selected node
  const selected = nodes.find(n => n.id === selectedId) || null;
  const selectedEdges = selected
    ? edges.filter(e => e.source === selected.id || e.target === selected.id)
    : [];

  // Recent nodes (last 3)
  const recent = [...nodes].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Intelligence graph']}
        right={<Pill kind="ok" dot>{nodes.length} nodes · {edges.length} edges</Pill>}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="graph" />

        {/* Filters */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            background: 'var(--surface)',
            overflow: 'auto',
          }}
        >
          <GraphFilters typeCounts={typeCounts} recent={recent} onSelectRecent={setSelectedId} />
        </div>

        {/* Canvas */}
        <div
          style={{
            flex: 1,
            position: 'relative',
            background: 'var(--paper)',
            overflow: 'hidden',
          }}
        >
          {nodes.length === 0 ? (
            <GraphEmpty loading={loading} />
          ) : (
            <>
              <GraphCanvas
                nodes={nodes}
                edges={edges}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
              <GraphToolbar />
            </>
          )}
        </div>

        {/* Detail */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderLeft: '1px solid var(--line)',
            background: 'var(--surface)',
            overflow: 'auto',
          }}
        >
          {selected ? (
            <NodeDetailPanel node={selected} edges={selectedEdges} allNodes={nodes} />
          ) : (
            <div
              style={{
                padding: 32,
                fontSize: 12,
                color: 'var(--ink-5)',
                textAlign: 'center',
              }}
            >
              Click a node to inspect it.
            </div>
          )}
        </div>
      </div>
      <StatusBar
        heartbeatLabel={`graph · ${nodes.length} nodes`}
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${edges.length} edges`}
        hints={['scroll canvas to pan · click a node']}
      />
    </div>
  );
}

// =============================================================================
// Filters
// =============================================================================

function GraphFilters({
  typeCounts,
  recent,
  onSelectRecent,
}: {
  typeCounts: Record<string, number>;
  recent: GraphNode[];
  onSelectRecent: (id: string) => void;
}) {
  return (
    <div style={{ padding: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 8,
        }}
      >
        Node types
      </div>
      {Object.entries(typeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => (
          <label
            key={k}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 4px',
              fontSize: 12,
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                border: '1px solid var(--line-2)',
                background: 'var(--paper-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon d={I.check} size={8} style={{ color: 'var(--ink)' }} />
            </span>
            <span
              className="lp-dot"
              style={{ background: TYPE_COLOR[k] || 'var(--ink-5)', width: 8, height: 8 }}
            />
            <span style={{ flex: 1, textTransform: 'capitalize' }}>
              {TYPE_LABEL[k] || k.replace(/_/g, ' ')}
            </span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              {n}
            </span>
          </label>
        ))}

      {Object.keys(typeCounts).length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: 8 }}>
          No node types yet.
        </div>
      )}

      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginTop: 18,
          marginBottom: 8,
        }}
      >
        Recent
      </div>
      {recent.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: 4 }}>No nodes yet.</div>
      ) : (
        recent.map((r, i) => {
          const ageHours = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
          const isLive = ageHours < 1;
          return (
            <div
              key={r.id}
              onClick={() => onSelectRecent(r.id)}
              style={{
                padding: 8,
                borderRadius: 6,
                background: isLive ? 'var(--accent-wash)' : 'transparent',
                marginBottom: 4,
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                {r.name}
                {isLive && <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />}
              </div>
              <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                {r.node_type} · {humanAge(r.created_at)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// =============================================================================
// Canvas (static polar layout)
// =============================================================================

function GraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const W = 840;
  const H = 600;
  const cx = W / 2;
  const cy = H / 2;

  // Layout: self nodes at center, others on concentric rings grouped by type
  const positioned = useMemo(() => {
    const selfNodes = nodes.filter(n => n.node_type === 'your_startup');
    const others = nodes.filter(n => n.node_type !== 'your_startup').slice(0, 30);
    const result: Record<string, { x: number; y: number; r: number; node: GraphNode }> = {};

    selfNodes.forEach((n, i) => {
      result[n.id] = { x: cx, y: cy, r: 22, node: n };
    });

    // Group by type for visual clustering
    const byType: Record<string, GraphNode[]> = {};
    others.forEach(n => { (byType[n.node_type] ||= []).push(n); });

    const types = Object.keys(byType);
    const typeAngles: Record<string, number> = {};
    types.forEach((t, i) => { typeAngles[t] = (i / types.length) * 2 * Math.PI; });

    for (const [type, typeNodes] of Object.entries(byType)) {
      const baseAngle = typeAngles[type];
      const spread = 0.8;
      typeNodes.forEach((n, i) => {
        const ring = i < 4 ? 190 : 260; // 2 rings per type
        const local = typeNodes.length > 1 ? ((i % 4) - 1.5) / 1.5 : 0;
        const angle = baseAngle + (local * spread) / Math.max(1, typeNodes.length * 0.5);
        result[n.id] = {
          x: cx + Math.cos(angle) * ring,
          y: cy + Math.sin(angle) * ring,
          r: 10,
          node: n,
        };
      });
    }

    return result;
  }, [nodes, cx, cy]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%', display: 'block' }}>
      <defs>
        <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.6" fill="var(--ink-6)" opacity="0.4" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#dots)" />

      {/* Edges */}
      {edges.map((e) => {
        const a = positioned[e.source];
        const b = positioned[e.target];
        if (!a || !b) return null;
        return (
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--ink-5)"
            strokeWidth={0.6}
            opacity={0.5}
          />
        );
      })}

      {/* Nodes */}
      {Object.entries(positioned).map(([id, p]) => {
        const n = p.node;
        const sel = id === selectedId;
        const color = TYPE_COLOR[n.node_type] || 'var(--ink-5)';
        const isSelf = n.node_type === 'your_startup';
        return (
          <g
            key={id}
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(id)}
          >
            {isSelf && (
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r + 6}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="0.8"
                opacity="0.3"
                strokeDasharray="2 2"
              />
            )}
            <circle cx={p.x} cy={p.y} r={p.r} fill={color} opacity={isSelf ? 1 : 0.9} />
            {sel && (
              <circle
                cx={p.x}
                cy={p.y}
                r={p.r + 3}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
              />
            )}
            <text
              x={p.x}
              y={p.y + p.r + 14}
              fontSize="11"
              fill="var(--ink-2)"
              textAnchor="middle"
              fontWeight={isSelf ? 600 : 400}
              style={{ pointerEvents: 'none' }}
            >
              {n.name.slice(0, 22)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function GraphToolbar() {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        display: 'flex',
        gap: 6,
        padding: 4,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 6,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <IconBtn d={I.search} title="Search" />
      <IconBtn d={I.filter} title="Filter" />
      <IconBtn d={I.layers} title="Layout" />
      <span style={{ width: 1, background: 'var(--line)' }} />
      <span
        className="lp-mono"
        style={{ padding: '0 8px', fontSize: 11, color: 'var(--ink-4)', alignSelf: 'center' }}
      >
        −
      </span>
      <span
        className="lp-mono"
        style={{ padding: '0 8px', fontSize: 11, color: 'var(--ink-2)', alignSelf: 'center' }}
      >
        100%
      </span>
      <span
        className="lp-mono"
        style={{ padding: '0 8px', fontSize: 11, color: 'var(--ink-4)', alignSelf: 'center' }}
      >
        +
      </span>
    </div>
  );
}

function GraphEmpty({ loading }: { loading: boolean }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 40,
        textAlign: 'center',
      }}
    >
      <Icon d={I.graph} size={40} style={{ color: 'var(--ink-5)', opacity: 0.4 }} />
      <h2 className="lp-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: -0.4, margin: 0 }}>
        {loading ? 'Loading graph…' : 'No nodes yet.'}
      </h2>
      {!loading && (
        <p style={{ fontSize: 13, color: 'var(--ink-4)', maxWidth: 420, margin: 0, lineHeight: 1.5 }}>
          The graph fills as the co-founder runs ecosystem scans. Every competitor,
          IP filing, and partnership opportunity above relevance cutoff becomes a node.
        </p>
      )}
    </div>
  );
}

// =============================================================================
// Node detail panel
// =============================================================================

function NodeDetailPanel({
  node,
  edges,
  allNodes,
}: {
  node: GraphNode;
  edges: GraphEdge[];
  allNodes: GraphNode[];
}) {
  const attrs = Object.entries(node.attributes || {})
    .filter(([k, v]) => typeof v !== 'object' || v === null)
    .slice(0, 8);

  return (
    <div>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <Pill kind="warn" dot>
            {node.node_type.replace(/_/g, ' ')}
          </Pill>
          {humanAge(node.created_at).endsWith('m') && (
            <Pill kind="live" dot>just added</Pill>
          )}
        </div>
        <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: -0.3 }}>
          {node.name}
        </h3>
        <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 2 }}>
          {humanAge(node.created_at)} · id {node.id.slice(0, 10)}
        </div>
      </div>

      {node.summary && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            Summary
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--ink-2)', margin: 0, lineHeight: 1.5 }}>
            {node.summary}
          </p>
        </div>
      )}

      {attrs.length > 0 && (
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: 0.5,
              marginBottom: 8,
            }}
          >
            Attributes
          </div>
          {attrs.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', padding: '4px 0', fontSize: 12 }}>
              <span
                className="lp-mono"
                style={{
                  fontSize: 10.5,
                  color: 'var(--ink-5)',
                  width: 100,
                  textTransform: 'uppercase',
                  letterSpacing: 0.3,
                }}
              >
                {k}
              </span>
              <span style={{ color: 'var(--ink-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {String(v ?? '—')}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--ink-3)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 8,
          }}
        >
          Edges · {edges.length}
        </div>
        {edges.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--ink-5)' }}>No edges connected.</div>
        ) : (
          edges.slice(0, 8).map((e, i) => {
            const other = e.source === node.id ? e.target : e.source;
            const otherNode = allNodes.find(n => n.id === other);
            return (
              <div
                key={e.id}
                style={{
                  padding: '6px 0',
                  fontSize: 12,
                  borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                    {e.relation}
                  </span>
                  <Icon d={I.arrow} size={10} style={{ color: 'var(--ink-5)' }} />
                  <span style={{ fontWeight: 500 }}>{otherNode?.name || other.slice(0, 12)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function humanAge(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch {
    return iso;
  }
}
