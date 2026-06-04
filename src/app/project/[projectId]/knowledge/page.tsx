'use client';

/**
 * Knowledge — split surface.
 *
 * Left half: upload zone + KnowledgeReviewList (memory_facts + graph_nodes +
 *            tabular_reviews review/approve flow).
 * Right half: live D3 force-directed graph of the project's applied entities.
 *
 * Previously the graph lived on its own /graph route. It's now anchored in
 * Knowledge so the two surfaces — entities-as-list and entities-as-graph —
 * sit side by side. Each scrolls independently.
 */

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import KnowledgeReviewList from '@/components/knowledge/KnowledgeReviewList';
import KnowledgeUpload from '@/components/knowledge/KnowledgeUpload';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import DataRoomPanel from '@/components/knowledge/DataRoomPanel';
import type { GraphNode, GraphEdge } from '@/types/graph';

type KnowledgeTab = 'review' | 'data-room' | 'graph';

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

  const [tab, setTab] = useState<KnowledgeTab>('review');
  const [lastIngested, setLastIngested] = useState(0);
  // Entity proposals queued from the last upload. Pending nodes only — the
  // graph pane filters to applied, so the user must approve them in the
  // KnowledgeReviewList before they appear on the right.
  const [lastProposed, setLastProposed] = useState(0);
  // KnowledgeReviewList still uses a nonce prop to force its per-tab refetch
  // (its internal state isn't queryified). Upload bumps it; Apply/Reject
  // inside the list invalidates via the lp-knowledge-changed event bridge.
  const [refreshNonce, setRefreshNonce] = useState(0);

  // Graph: cached in TanStack Query under ['knowledge', projectId, 'graph'].
  // The QueryProvider event bridge auto-invalidates this whenever
  // lp-knowledge-changed fires (which KnowledgeReviewList dispatches on
  // every approve/reject), so the old debounce + nonce plumbing is no longer
  // needed — useQuery dedups concurrent invalidations naturally.
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

  // Refresh after an upload — bypasses the event bridge because uploads
  // don't currently dispatch lp-knowledge-changed (only Apply/Reject does).
  function invalidateKnowledge() {
    void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
  }

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

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
            {lastIngested > 0 && (
              <Pill kind="ok" dot>
                +{lastIngested} ingested
                {lastProposed > 0 && ` · +${lastProposed} proposals`}
              </Pill>
            )}
          </>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="knowledge" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Tab strip — three sibling surfaces over the same project knowledge.
              Review = upload + approve flow. Data Room = unified doc list +
              edit/export. Graph = D3 force-directed entity view. They live as
              tabs (not side-by-side) so each gets full width when active. */}
          <div
            role="tablist"
            style={{
              display: 'flex',
              gap: 4,
              padding: '8px 16px 0',
              borderBottom: '1px solid var(--line)',
              background: 'var(--paper)',
            }}
          >
            <TabButton active={tab === 'review'} onClick={() => setTab('review')}>Review</TabButton>
            <TabButton active={tab === 'data-room'} onClick={() => setTab('data-room')}>Data Room</TabButton>
            <TabButton active={tab === 'graph'} onClick={() => setTab('graph')}>Graph</TabButton>
          </div>

          {tab === 'review' && (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                padding: '20px 24px',
                background: 'var(--paper)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 920, margin: '0 auto' }}>
                <KnowledgeUpload
                  projectId={projectId}
                  onUploaded={(n, proposed) => {
                    setLastIngested(n);
                    setLastProposed(proposed ?? 0);
                    setRefreshNonce((v) => v + 1);
                    invalidateKnowledge();
                  }}
                />

                <section
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--r-l)',
                    padding: 14,
                  }}
                >
                  <KnowledgeReviewList
                    projectId={projectId}
                    locale="en"
                    refreshNonce={refreshNonce}
                  />
                </section>
              </div>
            </div>
          )}

          {tab === 'data-room' && <DataRoomPanel projectId={projectId} />}

          {tab === 'graph' && (
            <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--paper-2)' }}>
              {graphLoading ? (
                <GraphEmpty message="Loading graph…" />
              ) : graphError ? (
                <GraphEmpty message={`Couldn’t load graph: ${graphError}`} tone="error" />
              ) : !graph || graph.nodes.length === 0 ? (
                <GraphEmpty
                  message="No entities yet. Approve knowledge proposals in the Review tab to populate the graph."
                />
              ) : (
                <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} />
              )}
            </div>
          )}
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel="knowledge"
        budget={
          lastIngested > 0
            ? `${lastIngested} file${lastIngested === 1 ? '' : 's'} added`
            : `${nodeCount} entit${nodeCount === 1 ? 'y' : 'ies'}`
        }
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: '8px 14px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--ink-1)' : 'var(--ink-5)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        marginBottom: -1,
      }}
    >
      {children}
    </button>
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
