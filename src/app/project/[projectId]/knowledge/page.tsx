'use client';

/**
 * Knowledge — the project's knowledge GRAPH, full-bleed (2026-06: the only
 * Knowledge surface; the old All / Review / Upload tabs were removed).
 *
 * Shows applied entities AND pending proposals together: pending nodes render
 * dashed and hang off the `your_startup` root (the /api/graph route synthesizes
 * a virtual link so nothing floats), so the founder sees what's proposed and
 * can apply it (2 credits, debited server-side) by clicking it. The Co-pilot
 * proposes new knowledge in chat; un-applied items also wait in the Inbox.
 */

import { use } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import EntityGridFallback from '@/components/knowledge/EntityGridFallback';
import type { GraphNode, GraphEdge } from '@/types/graph';

interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const EMPTY_GRAPH: GraphResponse = { nodes: [], edges: [] };

export default function KnowledgePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const qc = useQueryClient();

  // Graph: cached under ['knowledge', projectId, 'graph']; the QueryProvider
  // event bridge auto-invalidates on lp-knowledge-changed (Apply/Dismiss).
  const {
    data: graph = EMPTY_GRAPH,
    isLoading: graphLoading,
    error: graphErrObj,
  } = useQuery<GraphResponse>({
    queryKey: ['knowledge', projectId, 'graph'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/graph/${projectId}`);
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const payload: GraphResponse = body?.data ?? body;
      return {
        nodes: Array.isArray(payload?.nodes) ? payload.nodes : [],
        edges: Array.isArray(payload?.edges) ? payload.edges : [],
      };
    },
  });
  const graphError = graphErrObj instanceof Error ? graphErrObj.message : null;

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const pendingCount = graph.nodes.filter(
    (n) => (n as { reviewed_state?: string }).reviewed_state === 'pending',
  ).length;

  // Apply a pending node into intelligence. The knowledge PATCH debits 2
  // credits server-side on pending→applied; we refetch so the node flips solid.
  async function applyNode(node: GraphNode) {
    const id = (node as { id?: string }).id;
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'applied' }),
      });
      if (!res.ok) return;
      window.dispatchEvent(new CustomEvent('lp-credits-changed'));
      window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
      void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
    } catch {
      /* non-fatal — the node stays pending, founder can retry */
    }
  }

  return (
    <div className="lp-frame">
      <TopBar
        projectId={projectId}
        breadcrumb={['Project', 'Knowledge']}
        right={
          <>
            {nodeCount > 0 && (
              <Pill kind="n">
                {nodeCount} node{nodeCount === 1 ? '' : 's'} · {edgeCount} edge{edgeCount === 1 ? '' : 's'}
              </Pill>
            )}
            {pendingCount > 0 && (
              <Pill kind="live" dot>
                {pendingCount} pending
              </Pill>
            )}
          </>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="knowledge" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--paper-2)' }}>
            {graphLoading ? (
              <GraphEmpty message="Loading graph…" />
            ) : graphError ? (
              <GraphEmpty message={`Couldn’t load graph: ${graphError}`} tone="error" />
            ) : nodeCount === 0 ? (
              <GraphEmpty message="No knowledge yet. As you chat, the Co-pilot proposes facts and entities — apply them to build this graph." />
            ) : edgeCount === 0 ? (
              // Nodes but zero relationships: the force viz would render
              // disconnected floating dots. Show a labeled grid instead.
              <EntityGridFallback nodes={graph.nodes} />
            ) : (
              <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} onApplyNode={applyNode} />
            )}
            {pendingCount > 0 && (
              <div
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  fontSize: 10.5,
                  color: 'var(--ink-5)',
                  background: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 6,
                  padding: '4px 8px',
                }}
              >
                Dashed = pending · click to apply (2 credits)
              </div>
            )}
          </div>
        </div>
      </div>

      <StatusBar
        heartbeatLabel={
          graphLoading
            ? 'graph · loading'
            : `graph · ${edgeCount} edge${edgeCount === 1 ? '' : 's'}`
        }
        ctxLabel="knowledge"
        budget={`${nodeCount} entit${nodeCount === 1 ? 'y' : 'ies'}`}
      />
    </div>
  );
}

function GraphEmpty({
  message,
  tone = 'info',
}: {
  message: string;
  tone?: 'info' | 'error';
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <p
        style={{
          fontSize: 12.5,
          color: tone === 'error' ? 'var(--clay)' : 'var(--ink-5)',
          textAlign: 'center',
          maxWidth: 360,
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>
    </div>
  );
}
