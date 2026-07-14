'use client';

/**
 * Knowledge — the project's knowledge GRAPH, full-bleed (2026-06: the only
 * Knowledge surface; the old All / Review / Upload tabs were removed).
 *
 * Shows applied entities AND pending proposals together: pending nodes render
 * dashed and hang off the `your_startup` root (the /api/graph route synthesizes
 * a virtual link so nothing floats), so the founder sees what's proposed and
 * can apply it (0.5 credits, debited server-side) by clicking it. The Co-pilot
 * proposes new knowledge in chat; un-applied items also wait in the Inbox.
 */

import { use, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { useSetChrome } from '@/components/design/chrome-context';
import { PanelBoundary } from '@/components/design/PanelBoundary';
import { Pill, Icon, I } from '@/components/design/primitives';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import type { TimelineEntry } from '@/components/graph/NodeDetailPanel';
import AllKnowledgePanel from '@/components/knowledge/AllKnowledgePanel';
import RecentMovesFeed from '@/components/knowledge/RecentMovesFeed';
import AddDocumentsDialog from '@/components/knowledge/AddDocumentsDialog';
import { CompetitorMatryoshka } from '@/components/knowledge/CompetitorMatryoshka';
import type { GraphNode, GraphEdge, MacroCategory } from '@/types/graph';
import { MACRO_CATEGORY_ORDER } from '@/types/graph';

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
  // Graph (D3 force viz) vs List (AllKnowledgePanel — every knowledge item
  // grouped by kind, each section gradient-tinted). Graph is the default.
  // ?view= deep link (e.g. the watcher run-summary "View in Knowledge →" links
  // to ?view=moves). Read once at mount; the toggle stays local state after.
  const [view, setView] = useState<'graph' | 'list' | 'moves'>(() => {
    if (typeof window !== 'undefined') {
      const v = new URLSearchParams(window.location.search).get('view');
      if (v === 'list' || v === 'moves' || v === 'graph') return v;
    }
    return 'graph';
  });
  // ?cat= deep link (Home legend chips) — open the graph pre-drilled into that
  // macro-category. Read once at mount, like ?view=; navigation is local after.
  const [initialCat] = useState<MacroCategory | null>(() => {
    if (typeof window !== 'undefined') {
      const c = new URLSearchParams(window.location.search).get('cat');
      if (c && (MACRO_CATEGORY_ORDER as string[]).includes(c)) return c as MacroCategory;
    }
    return null;
  });

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
  // Real relationships only — the /api/graph route synthesizes a virtual
  // root→node "belongs to" edge for every unconnected node so nothing floats,
  // but those are a layout artefact, not knowledge. Counting them made the
  // header claim edges a project doesn't have and forced a grid fallback.
  const edgeCount = graph.edges.filter(
    (e) => !(e as { virtual?: boolean }).virtual,
  ).length;
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
            data-tour="add-documents"
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

  // Save an edited node name/summary from the graph detail drawer. Free (an
  // edit, not an apply); PATCH carries {name, summary} instead of {state}. The
  // graph refetches so the node re-renders with the new label/summary.
  async function saveNode(node: GraphNode, patch: { name?: string; summary?: string }) {
    const id = (node as { id?: string }).id;
    if (!id) return;
    const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
    await qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
  }

  // Remove one dated move from a node's timeline (curating a wrong/misattributed
  // auto-added entry) without deleting the whole node. Free — content edit, not
  // an apply. Matched by the entry's alert_id; refetch so the row drops.
  async function deleteTimelineEntry(node: GraphNode, entry: TimelineEntry) {
    const id = (node as { id?: string }).id;
    if (!id || !entry.alert_id) return;
    const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove_timeline_alert_id: entry.alert_id }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
    await qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
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
      {/* Textual competitor matryoshka (item 14): startup → competitor → category
          → detail. Renders nothing when there are no competitors. */}
      <CompetitorMatryoshka projectId={projectId} />
      <div data-tour="knowledge-graph" style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--paper-2)' }}>
        {/* Graph ↔ List toggle (top-right; the graph's own search/expand sit top-left). */}
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 5, display: 'flex', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', overflow: 'hidden' }}>
          {(['graph', 'list', 'moves'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: '5px 12px',
                cursor: 'pointer',
                border: 'none',
                background: view === v ? 'var(--ink)' : 'transparent',
                color: view === v ? 'var(--on-accent, var(--paper))' : 'var(--ink-4)',
              }}
            >
              {t(v === 'graph' ? 'knowledge.view-graph' : v === 'list' ? 'knowledge.view-list' : 'knowledge.view-moves')}
            </button>
          ))}
        </div>
        {view === 'moves' ? (
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 16 }}>
            <RecentMovesFeed projectId={projectId} />
          </div>
        ) : view === 'list' ? (
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 16 }}>
            <PanelBoundary resetKey={projectId}>
              <AllKnowledgePanel projectId={projectId} />
            </PanelBoundary>
          </div>
        ) : graphLoading ? (
          <GraphEmpty message={t('knowledge.loading-graph')} />
        ) : graphError ? (
          <GraphEmpty message={t('knowledge.load-error', { error: graphError })} tone="error" />
        ) : nodeCount === 0 ? (
          <GraphEmpty
            message={t('knowledge.empty')}
            action={{ label: t('knowledge.add-documents'), onClick: () => setShowAddDocs(true) }}
          />
        ) : (
          // The graph now groups nodes into tinted macro-category regions even
          // with zero real edges, so the old "disconnected dots → grid" fallback
          // is no longer needed — the grouped graph IS the good edgeless view.
          // Boundary-wrapped: a d3-simulation render throw must not take the
          // whole Knowledge surface (incl. the textual list) down with it.
          <PanelBoundary resetKey={projectId}>
            <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} onApplyNode={applyNode} onDismissNode={dismissNode} onSaveNode={saveNode} onDeleteTimelineEntry={deleteTimelineEntry} showEmptyCategories initialFocusedCategory={initialCat} />
          </PanelBoundary>
        )}
        {view === 'graph' && pendingCount > 0 && (
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
  action,
}: {
  message: string;
  tone?: 'info' | 'error';
  /** Optional CTA shown under the message — e.g. "Add documents" on an empty graph. */
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
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
      {action && (
        <button
          onClick={action.onClick}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--on-accent)',
            background: 'var(--accent)',
            border: 'none',
            borderRadius: 'var(--r-m)',
            padding: '8px 14px',
            cursor: 'pointer',
          }}
        >
          <Icon d={I.plus} size={14} stroke={1.8} />
          {action.label}
        </button>
      )}
    </div>
  );
}
