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

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { useSetChrome } from '@/components/design/chrome-context';
import { Pill, Icon, I } from '@/components/design/primitives';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import EntityGridFallback from '@/components/knowledge/EntityGridFallback';
import AddDocumentsDialog from '@/components/knowledge/AddDocumentsDialog';
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
  const t = useT();
  const qc = useQueryClient();
  const [showAddDocs, setShowAddDocs] = useState(false);

  // After the popup applies extracted entities, refetch the graph and bump the
  // credits/knowledge listeners — same invalidation contract as applyNode below.
  function onDocsApplied(_applied: number, creditsDebited: number) {
    if (creditsDebited > 0) window.dispatchEvent(new CustomEvent('lp-credits-changed'));
    window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
    void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
  }

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

  // Publish this page's chrome bits (TopBar breadcrumb + right pills/Add-docs
  // button, StatusBar graph counts) to the persistent project layout. Called
  // unconditionally before any return; re-publishes when the live counts move.
  useSetChrome(
    {
      breadcrumb: [t('knowledge.breadcrumb-project'), t('knowledge.breadcrumb-knowledge')],
      right: (
        <>
          {nodeCount > 0 && (
            <Pill kind="n">
              {nodeCount === 1
                ? t('knowledge.nodes-one', { nodes: nodeCount })
                : t('knowledge.nodes-many', { nodes: nodeCount })}
              {' · '}
              {edgeCount === 1
                ? t('knowledge.edges-one', { edges: edgeCount })
                : t('knowledge.edges-many', { edges: edgeCount })}
            </Pill>
          )}
          {pendingCount > 0 && (
            <Pill kind="live" dot>
              {t('knowledge.pending-count', { count: pendingCount })}
            </Pill>
          )}
          <button
            onClick={() => setShowAddDocs(true)}
            title={t('knowledge.add-documents-tooltip')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--ink-2)',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-m)',
              padding: '5px 10px',
              cursor: 'pointer',
            }}
          >
            <Icon d={I.plus} size={13} stroke={1.8} />
            {t('knowledge.add-documents')}
          </button>
        </>
      ),
      status: {
        heartbeatLabel: graphLoading
          ? t('knowledge.status-graph-loading')
          : edgeCount === 1
            ? t('knowledge.status-graph-edges-one', { edges: edgeCount })
            : t('knowledge.status-graph-edges-many', { edges: edgeCount }),
        ctxLabel: t('knowledge.status-ctx'),
        budget:
          nodeCount === 1
            ? t('knowledge.status-entities-one', { entities: nodeCount })
            : t('knowledge.status-entities-many', { entities: nodeCount }),
      },
    },
    [nodeCount, edgeCount, pendingCount, graphLoading],
  );

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

  // Dismiss a pending node (reject). Unlike Apply this debits NOTHING, so we
  // fire only lp-knowledge-changed (no lp-credits-changed) and refetch so the
  // rejected node drops out of the graph.
  async function dismissNode(node: GraphNode) {
    const id = (node as { id?: string }).id;
    if (!id) return;
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'rejected' }),
      });
      if (!res.ok) return;
      window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
      void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
    } catch {
      /* non-fatal — the node stays pending, founder can retry */
    }
  }

  return (
    <div className="lp-rise" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--paper-2)' }}>
        {graphLoading ? (
          <GraphEmpty message={t('knowledge.loading-graph')} />
        ) : graphError ? (
          <GraphEmpty message={t('knowledge.load-error', { error: graphError })} tone="error" />
        ) : nodeCount === 0 ? (
          <GraphEmpty message={t('knowledge.empty')} />
        ) : edgeCount === 0 ? (
          // Nodes but zero relationships: the force viz would render
          // disconnected floating dots. Show a labeled grid instead.
          <EntityGridFallback nodes={graph.nodes} />
        ) : (
          <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} onApplyNode={applyNode} onDismissNode={dismissNode} />
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
            {t('knowledge.dashed-hint')}
          </div>
        )}
      </div>

      {showAddDocs && (
        <AddDocumentsDialog
          projectId={projectId}
          onClose={() => setShowAddDocs(false)}
          onApplied={onDocsApplied}
        />
      )}
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
