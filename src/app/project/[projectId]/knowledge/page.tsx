'use client';

/**
 * Knowledge — one surface, three sub-views switched by the KnowledgeSidebar:
 *
 *   · Curated ("Project Knowledge") — applied KnowledgeItems (unified read),
 *     rendered as KnowledgeRow. The grounding the co-pilot reads from.
 *   · Inbox — pending findings grouped by kind (InboxGroup); Apply (2 credits,
 *     debited server-side) / Reject via the proven knowledge PATCH.
 *   · Graph — the existing full-bleed knowledge graph (kept as a view).
 *
 * One nav item; the sidebar swaps the right pane in-page. The Co-pilot proposes
 * knowledge in chat; un-applied items land here in the Inbox.
 */

import { use, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import { useSetChrome } from '@/components/design/chrome-context';
import { Pill, Icon, I } from '@/components/design/primitives';
import { KnowledgeSidebar, type KnowledgeView } from '@/components/shared/KnowledgeSidebar';
import { KnowledgeRow, type KnowledgeTone } from '@/components/shared/KnowledgeRow';
import { InboxGroup, type TriageRow } from '@/components/shared/InboxGroup';
import KnowledgeGraph from '@/components/graph/KnowledgeGraph';
import EntityGridFallback from '@/components/knowledge/EntityGridFallback';
import AllKnowledgePanel from '@/components/knowledge/AllKnowledgePanel';
import AddDocumentsDialog from '@/components/knowledge/AddDocumentsDialog';
import { CompetitorMatryoshka } from '@/components/knowledge/CompetitorMatryoshka';
import type { GraphNode, GraphEdge } from '@/types/graph';

type View = 'all' | 'inbox' | 'graph';

interface GraphResponse { nodes: GraphNode[]; edges: GraphEdge[]; }
const EMPTY_GRAPH: GraphResponse = { nodes: [], edges: [] };

interface PendingItem { id: string; type: string; title: string; detail: string | null; kind: string | null; created_at: string; }
interface CuratedItem { id: string; kind: string; title: string; summary: string | null; sourceRef: string | null; provenanceTier?: string; }

function toneForKind(kind: string | null): KnowledgeTone {
  const k = (kind || '').toLowerCase();
  if (k.includes('competitor')) return 'warn';
  if (k.includes('persona') || k.includes('icp') || k.includes('customer')) return 'plum';
  if (k.includes('market') || k.includes('tam')) return 'info';
  if (k.includes('risk')) return 'warn';
  if (k.includes('insight') || k.includes('finding')) return 'ok';
  return 'n';
}

function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function KnowledgePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const t = useT();
  const qc = useQueryClient();
  const [view, setView] = useState<View>('all');
  const [showAddDocs, setShowAddDocs] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: graph = EMPTY_GRAPH, isLoading: graphLoading, error: graphErrObj } = useQuery<GraphResponse>({
    queryKey: ['knowledge', projectId, 'graph'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/graph/${projectId}`);
      const body = await res.json();
      if (!res.ok || body?.success === false) throw new Error(body?.error || `HTTP ${res.status}`);
      const payload: GraphResponse = body?.data ?? body;
      return { nodes: Array.isArray(payload?.nodes) ? payload.nodes : [], edges: Array.isArray(payload?.edges) ? payload.edges : [] };
    },
  });
  const graphError = graphErrObj instanceof Error ? graphErrObj.message : null;

  const { data: curated = [] } = useQuery<CuratedItem[]>({
    queryKey: ['knowledge', projectId, 'curated'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/knowledge/unified`);
      const body = await res.json();
      return (body?.data?.items ?? []) as CuratedItem[];
    },
  });

  const { data: pending = [] } = useQuery<PendingItem[]>({
    queryKey: ['knowledge', projectId, 'pending'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/knowledge?state=pending`);
      const body = await res.json();
      return (body?.data?.items ?? []) as PendingItem[];
    },
  });

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;

  // ── Inbox grouping ────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const byKind = new Map<string, TriageRow[]>();
    for (const p of pending) {
      const label = (p.kind || p.type || 'other').replace(/_/g, ' ');
      const rows = byKind.get(label) ?? [];
      rows.push({ id: p.id, title: p.title, source: p.detail || undefined, age: ago(p.created_at) });
      byKind.set(label, rows);
    }
    return Array.from(byKind.entries()).map(([label, rows]) => ({ label, rows }));
  }, [pending]);

  // ── Chrome ─────────────────────────────────────────────────────────────────
  useSetChrome(
    {
      breadcrumb: [t('knowledge.breadcrumb-project'), t('knowledge.breadcrumb-knowledge')],
      right: (
        <>
          {pending.length > 0 && <Pill kind="live" dot>{t('knowledge.pending-count', { count: pending.length })}</Pill>}
          <button
            onClick={() => setShowAddDocs(true)}
            title={t('knowledge.add-documents-tooltip')}
            className="lp-btn"
            style={{ padding: '5px 10px' }}
          >
            <Icon d={I.plus} size={13} stroke={1.8} /> {t('knowledge.add-documents')}
          </button>
        </>
      ),
    },
    [pending.length],
  );

  // ── Mutations (proven PATCH; 2cr on apply, free on reject) ──────────────────
  async function patch(id: string, state: 'applied' | 'rejected') {
    const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) return false;
    if (state === 'applied') window.dispatchEvent(new CustomEvent('lp-credits-changed'));
    window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
    void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
    return true;
  }
  const applyOne = (id: string) => { setSelected((s) => { const n = new Set(s); n.delete(id); return n; }); void patch(id, 'applied'); };
  const rejectOne = (id: string) => { setSelected((s) => { const n = new Set(s); n.delete(id); return n; }); void patch(id, 'rejected'); };
  const applySelected = async () => { const ids = [...selected]; setSelected(new Set()); for (const id of ids) await patch(id, 'applied'); };
  const toggleSelect = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  function applyNode(node: GraphNode) { const id = (node as { id?: string }).id; if (id) void patch(id, 'applied'); }
  function dismissNode(node: GraphNode) { const id = (node as { id?: string }).id; if (id) void patch(id, 'rejected'); }
  function onDocsApplied(_a: number, credits: number) {
    if (credits > 0) window.dispatchEvent(new CustomEvent('lp-credits-changed'));
    window.dispatchEvent(new CustomEvent('lp-knowledge-changed'));
    void qc.invalidateQueries({ queryKey: ['knowledge', projectId] });
  }

  const views: KnowledgeView[] = [
    { id: 'all', label: 'Project Knowledge', iconKey: 'book', count: curated.length },
    { id: 'inbox', label: 'Inbox', iconKey: 'tickets', count: pending.length, hi: pending.length > 0 },
    { id: 'graph', label: 'Graph', iconKey: 'graph', count: nodeCount },
  ];

  return (
    <div className="lp-rise" style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
      <KnowledgeSidebar views={views} active={view} onSelect={(id) => setView(id as View)} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* 'all' renders AllKnowledgePanel (PR #175: every knowledge item grouped
            by kind, gradient-tinted sections). It supersedes the mockup-era
            CuratedView: when the sidebar IA (this restyle) met the Graph↔List
            toggle (#175), the sidebar's Project Knowledge entry became the list
            view, so the floating toggle is gone and one list implementation wins. */}
        {view === 'all' && (
          <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
            <AllKnowledgePanel projectId={projectId} />
          </div>
        )}
        {view === 'inbox' && (
          <InboxView
            groups={groups}
            selected={selected}
            onToggleSelect={toggleSelect}
            onApply={applyOne}
            onReject={rejectOne}
            onApplySelected={applySelected}
          />
        )}
        {view === 'graph' && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <CompetitorMatryoshka projectId={projectId} />
            <div style={{ flex: 1, minHeight: 0, position: 'relative', background: 'var(--paper-2)' }}>
              {graphLoading ? (
                <GraphEmpty message={t('knowledge.loading-graph')} />
              ) : graphError ? (
                <GraphEmpty message={t('knowledge.load-error', { error: graphError })} tone="error" />
              ) : nodeCount === 0 ? (
                <GraphEmpty message={t('knowledge.empty')} action={{ label: t('knowledge.add-documents'), onClick: () => setShowAddDocs(true) }} />
              ) : edgeCount === 0 ? (
                <EntityGridFallback nodes={graph.nodes} />
              ) : (
                <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} onApplyNode={applyNode} onDismissNode={dismissNode} />
              )}
              {pending.length > 0 && (
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
          </div>
        )}
      </div>

      {showAddDocs && <AddDocumentsDialog projectId={projectId} onClose={() => setShowAddDocs(false)} onApplied={onDocsApplied} />}
    </div>
  );
}

function InboxView({
  groups,
  selected,
  onToggleSelect,
  onApply,
  onReject,
  onApplySelected,
}: {
  groups: { label: string; rows: TriageRow[] }[];
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onApply: (id: string) => void;
  onReject: (id: string) => void;
  onApplySelected: () => void;
}) {
  const total = groups.reduce((a, g) => a + g.rows.length, 0);
  return (
    <>
      <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--line)' }}>
        <div className="lp-row">
          <div style={{ flex: 1 }}>
            <h2 className="lp-h4" style={{ margin: 0 }}>Inbox</h2>
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{total} findings pending review</div>
          </div>
          <button className="lp-btn lp-btn-ok" disabled={selected.size === 0} onClick={onApplySelected}>
            <Icon d={I.check} size={11} /> Apply selected ({selected.size})
          </button>
        </div>
      </div>
      <div className="lp-scroll" style={{ flex: 1, overflow: 'auto' }}>
        {total === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-4)', fontSize: 12.5 }}>Inbox zero — nothing to triage.</div>
        ) : (
          groups.map((g) => (
            <InboxGroup
              key={g.label}
              label={g.label}
              rows={g.rows}
              selected={selected}
              onSelect={onToggleSelect}
              onApply={onApply}
              onReject={onReject}
            />
          ))
        )}
      </div>
    </>
  );
}

function GraphEmpty({ message, tone = 'info', action }: { message: string; tone?: 'info' | 'error'; action?: { label: string; onClick: () => void } }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }}>
      <p style={{ fontSize: 12.5, color: tone === 'error' ? 'var(--clay)' : 'var(--ink-4)', textAlign: 'center', maxWidth: 360, margin: 0, lineHeight: 1.5 }}>{message}</p>
      {action && (
        <button onClick={action.onClick} className="lp-btn lp-btn-primary">
          <Icon d={I.plus} size={14} stroke={1.8} /> {action.label}
        </button>
      )}
    </div>
  );
}
