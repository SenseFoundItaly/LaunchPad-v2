'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import type { ReviewedState } from '@/types/artifacts';

// =============================================================================
// Types
// =============================================================================

interface KnowledgeItem {
  id: string;
  type: 'fact' | 'graph_node' | 'tabular_review';
  title: string;
  detail: string | null;
  kind: string | null;
  reviewed_state: ReviewedState;
  created_at: string;
}

interface UndoEntry {
  item: KnowledgeItem;
  state: 'applied' | 'rejected';
  timerId: ReturnType<typeof setTimeout>;
}

type KnowledgeTab = 'pending' | 'applied' | 'rejected';

interface PendingKnowledgeListProps {
  projectId: string;
  locale: 'en' | 'it';
}

// =============================================================================
// Constants
// =============================================================================

const TYPE_LABELS: Record<string, string> = {
  fact: 'Fact',
  graph_node: 'Entity',
  tabular_review: 'Review',
};

const TYPE_COLORS: Record<string, string> = {
  fact: 'bg-accent/20 text-accent',
  graph_node: 'bg-cat-teal/20 text-cat-teal',
  tabular_review: 'bg-plum/20 text-plum',
};

const STRINGS: Record<string, { en: string; it: string }> = {
  tabProposals:  { en: 'Proposals',  it: 'Proposte' },
  tabInContext:  { en: 'In Context', it: 'In contesto' },
  tabRejected:   { en: 'Rejected',   it: 'Rifiutati' },
  explainer:     { en: 'AI-proposed knowledge. Review to add to your project\u2019s context, or reject.',
                   it: 'Conoscenza proposta dall\u2019AI. Approva per aggiungere al contesto, o rifiuta.' },
  approve:       { en: 'Approve',   it: 'Approva' },
  reject:        { en: 'Reject',    it: 'Rifiuta' },
  remove:        { en: 'Remove',    it: 'Rimuovi' },
  restore:       { en: 'Restore',   it: 'Ripristina' },
  applyAll:      { en: 'Apply All', it: 'Applica tutto' },
  undo:          { en: 'Undo',      it: 'Annulla' },
  emptyPending:  { en: 'No pending proposals',       it: 'Nessuna proposta in attesa' },
  emptyApplied:  { en: 'No items in context yet',    it: 'Nessun elemento nel contesto' },
  emptyRejected: { en: 'No rejected items',          it: 'Nessun elemento rifiutato' },
  applied:       { en: 'Applied',   it: 'Applicato' },
  rejected:      { en: 'Rejected',  it: 'Rifiutato' },
  loading:       { en: 'Loading\u2026', it: 'Caricamento\u2026' },
};

function t(key: string, locale: 'en' | 'it'): string {
  return STRINGS[key]?.[locale] ?? STRINGS[key]?.en ?? key;
}

// =============================================================================
// SVG Icons (14x14)
// =============================================================================

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
    <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
    <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
    <path d="M2 6.5C2 4.01 4.01 2 6.5 2S11 4.01 11 6.5 8.99 11 6.5 11c-1.66 0-3.1-.9-3.88-2.23" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <path d="M2 3v3.5h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// =============================================================================
// KnowledgeItemCard (local sub-component)
// =============================================================================

function KnowledgeItemCard({
  item,
  actions,
}: {
  item: KnowledgeItem;
  actions: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2 bg-paper-2/50 border border-line-2 rounded-lg px-3 py-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[item.type] ?? 'bg-ink-5/20 text-ink-4'}`}>
            {TYPE_LABELS[item.type] ?? item.type}
          </span>
          {item.kind && item.kind !== 'review' && (
            <span className="text-[10px] text-ink-5">{item.kind}</span>
          )}
        </div>
        <p className="text-xs text-ink-2 truncate">{item.title}</p>
        {item.detail && (
          <p className="text-[10px] text-ink-5 mt-0.5 line-clamp-2">{item.detail}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
        {actions}
      </div>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export default function PendingKnowledgeList({ projectId, locale }: PendingKnowledgeListProps) {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('pending');
  const [pendingItems, setPendingItems] = useState<KnowledgeItem[]>([]);
  const [appliedItems, setAppliedItems] = useState<KnowledgeItem[]>([]);
  const [rejectedItems, setRejectedItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);
  const [partialError, setPartialError] = useState<string | null>(null);

  const undoQueueRef = useRef(undoQueue);
  undoQueueRef.current = undoQueue;

  const loadedTabs = useRef<Set<KnowledgeTab>>(new Set(['pending']));

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchItemsForTab = useCallback(async (tab: KnowledgeTab) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge?state=${tab}`);
      if (!res.ok) {
        console.warn(`[KnowledgeList] fetch ${tab} failed: HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      const data: KnowledgeItem[] = json.data?.items ?? [];
      if (tab === 'pending') setPendingItems(data);
      else if (tab === 'applied') setAppliedItems(data);
      else setRejectedItems(data);
    } catch (err) {
      console.warn(`[KnowledgeList] fetch ${tab} error:`, (err as Error).message);
    }
  }, [projectId]);

  // Eager load pending on mount
  useEffect(() => {
    void fetchItemsForTab('pending').finally(() => setLoading(false));
  }, [fetchItemsForTab]);

  // Lazy load other tabs on first click
  function handleTabClick(tab: KnowledgeTab) {
    setActiveTab(tab);
    if (!loadedTabs.current.has(tab)) {
      loadedTabs.current.add(tab);
      void fetchItemsForTab(tab);
    }
  }

  // ---------------------------------------------------------------------------
  // PATCH helper
  // ---------------------------------------------------------------------------

  async function patchItem(itemId: string, state: string) {
    const res = await fetch(`/api/projects/${projectId}/knowledge/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  // ---------------------------------------------------------------------------
  // Approve (pending -> applied)
  // ---------------------------------------------------------------------------

  async function handleApprove(itemId: string) {
    const item = pendingItems.find((i) => i.id === itemId);
    if (!item) return;
    setPendingItems((prev) => prev.filter((i) => i.id !== itemId));
    if (loadedTabs.current.has('applied')) {
      setAppliedItems((prev) => [{ ...item, reviewed_state: 'applied' as ReviewedState }, ...prev]);
    }
    setPartialError(null);
    try {
      await patchItem(itemId, 'applied');
      const timerId = setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
      }, 8_000);
      setUndoQueue((prev) => [...prev, { item, state: 'applied', timerId }]);
    } catch (err) {
      console.warn('[KnowledgeList] approve failed, reverting:', (err as Error).message);
      void fetchItemsForTab('pending');
      if (loadedTabs.current.has('applied')) void fetchItemsForTab('applied');
    }
  }

  // ---------------------------------------------------------------------------
  // Reject (pending -> rejected)
  // ---------------------------------------------------------------------------

  async function handleReject(itemId: string) {
    const item = pendingItems.find((i) => i.id === itemId);
    if (!item) return;
    setPendingItems((prev) => prev.filter((i) => i.id !== itemId));
    if (loadedTabs.current.has('rejected')) {
      setRejectedItems((prev) => [{ ...item, reviewed_state: 'rejected' as ReviewedState }, ...prev]);
    }
    setPartialError(null);
    try {
      await patchItem(itemId, 'rejected');
      const timerId = setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
      }, 8_000);
      setUndoQueue((prev) => [...prev, { item, state: 'rejected', timerId }]);
    } catch (err) {
      console.warn('[KnowledgeList] reject failed, reverting:', (err as Error).message);
      void fetchItemsForTab('pending');
      if (loadedTabs.current.has('rejected')) void fetchItemsForTab('rejected');
    }
  }

  // ---------------------------------------------------------------------------
  // Remove (applied -> rejected)
  // ---------------------------------------------------------------------------

  async function handleRemove(itemId: string) {
    const item = appliedItems.find((i) => i.id === itemId);
    if (!item) return;
    setAppliedItems((prev) => prev.filter((i) => i.id !== itemId));
    if (loadedTabs.current.has('rejected')) {
      setRejectedItems((prev) => [{ ...item, reviewed_state: 'rejected' as ReviewedState }, ...prev]);
    }
    try {
      await patchItem(itemId, 'rejected');
    } catch (err) {
      console.warn('[KnowledgeList] remove failed, reverting:', (err as Error).message);
      void fetchItemsForTab('applied');
      if (loadedTabs.current.has('rejected')) void fetchItemsForTab('rejected');
    }
  }

  // ---------------------------------------------------------------------------
  // Restore (rejected -> pending)
  // ---------------------------------------------------------------------------

  async function handleRestore(itemId: string) {
    const item = rejectedItems.find((i) => i.id === itemId);
    if (!item) return;
    setRejectedItems((prev) => prev.filter((i) => i.id !== itemId));
    setPendingItems((prev) => [{ ...item, reviewed_state: 'pending' as ReviewedState }, ...prev]);
    try {
      await patchItem(itemId, 'pending');
    } catch (err) {
      console.warn('[KnowledgeList] restore failed, reverting:', (err as Error).message);
      void fetchItemsForTab('rejected');
      void fetchItemsForTab('pending');
    }
  }

  // ---------------------------------------------------------------------------
  // Undo (proposals tab only — reverses approve/reject)
  // ---------------------------------------------------------------------------

  async function handleUndo(itemId: string) {
    const entry = undoQueueRef.current.find((u) => u.item.id === itemId);
    if (!entry) return;
    clearTimeout(entry.timerId);
    setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
    // Remove from destination tab
    if (entry.state === 'applied' && loadedTabs.current.has('applied')) {
      setAppliedItems((prev) => prev.filter((i) => i.id !== itemId));
    }
    if (entry.state === 'rejected' && loadedTabs.current.has('rejected')) {
      setRejectedItems((prev) => prev.filter((i) => i.id !== itemId));
    }
    // Re-add to pending
    setPendingItems((prev) => [entry.item, ...prev]);
    try {
      await patchItem(itemId, 'pending');
    } catch (err) {
      console.warn('[KnowledgeList] undo failed:', (err as Error).message);
    }
  }

  // ---------------------------------------------------------------------------
  // Apply All
  // ---------------------------------------------------------------------------

  async function handleApplyAll() {
    setPartialError(null);
    const allItems = [...pendingItems];
    const ids = allItems.map((i) => i.id);
    setPendingItems([]);
    if (loadedTabs.current.has('applied')) {
      setAppliedItems((prev) => [
        ...allItems.map((i) => ({ ...i, reviewed_state: 'applied' as ReviewedState })),
        ...prev,
      ]);
    }
    let failCount = 0;
    for (const id of ids) {
      try {
        await patchItem(id, 'applied');
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      setPartialError(`${failCount} of ${ids.length} items failed to apply`);
      void fetchItemsForTab('pending');
      if (loadedTabs.current.has('applied')) void fetchItemsForTab('applied');
    } else {
      const timerId = setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => !ids.includes(u.item.id)));
      }, 8_000);
      setUndoQueue((prev) => [
        ...prev,
        ...allItems.map((item) => ({ item, state: 'applied' as const, timerId })),
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // Tab config
  // ---------------------------------------------------------------------------

  const tabs: { key: KnowledgeTab; label: string; count: number }[] = [
    { key: 'pending',  label: t('tabProposals', locale), count: pendingItems.length },
    { key: 'applied',  label: t('tabInContext', locale),  count: appliedItems.length },
    { key: 'rejected', label: t('tabRejected', locale),   count: rejectedItems.length },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return <div className="text-xs text-ink-5 py-2">{t('loading', locale)}</div>;
  }

  return (
    <div className="space-y-2">
      {/* Tab bar */}
      <div className="flex gap-0 border-b border-line-2">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => handleTabClick(key)}
            className={`text-[11px] px-3 py-1.5 transition-colors ${
              activeTab === key
                ? 'text-ink font-semibold border-b-2 border-moss'
                : 'text-ink-4 hover:text-ink-2'
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {partialError && (
        <div className="p-2 bg-clay/10 border border-clay/40 rounded text-[11px] text-clay">
          {partialError}
        </div>
      )}

      {/* ── Proposals tab ── */}
      {activeTab === 'pending' && (
        <div className="space-y-2">
          {/* Explainer banner */}
          <div className="text-[11px] text-ink-4 bg-paper-2/50 border border-line rounded-lg px-3 py-2">
            {t('explainer', locale)}
          </div>

          {pendingItems.length > 0 && (
            <div className="flex items-center justify-end">
              <button
                onClick={() => void handleApplyAll()}
                className="text-xs px-3 py-1 rounded bg-moss-wash text-moss hover:bg-moss/30 transition-colors font-medium"
              >
                {t('applyAll', locale)}
              </button>
            </div>
          )}

          {pendingItems.length === 0 ? (
            <div className="text-xs text-ink-5 py-2">{t('emptyPending', locale)}</div>
          ) : (
            pendingItems.map((item) => (
              <KnowledgeItemCard
                key={item.id}
                item={item}
                actions={
                  <>
                    <button
                      onClick={() => void handleApprove(item.id)}
                      className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-moss-wash text-moss hover:bg-moss/30 transition-colors"
                    >
                      <CheckIcon /> {t('approve', locale)}
                    </button>
                    <button
                      onClick={() => void handleReject(item.id)}
                      className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-paper-3/50 text-ink-5 hover:text-clay hover:bg-clay/20 transition-colors"
                    >
                      <XIcon /> {t('reject', locale)}
                    </button>
                  </>
                }
              />
            ))
          )}

          {undoQueue.length > 0 && (
            <div className="space-y-1 pt-1">
              {undoQueue.map((entry) => (
                <div
                  key={entry.item.id}
                  className="flex items-center justify-between bg-paper-3/40 border border-line-2 rounded px-2.5 py-1.5"
                >
                  <span className="text-[10px] text-ink-4 truncate flex-1 mr-2">
                    {t(entry.state, locale)}: {entry.item.title}
                  </span>
                  <button
                    onClick={() => void handleUndo(entry.item.id)}
                    className="text-[10px] px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium flex-shrink-0"
                  >
                    {t('undo', locale)}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── In Context tab ── */}
      {activeTab === 'applied' && (
        <div className="space-y-2">
          {appliedItems.length === 0 ? (
            <div className="text-xs text-ink-5 py-2">{t('emptyApplied', locale)}</div>
          ) : (
            appliedItems.map((item) => (
              <KnowledgeItemCard
                key={item.id}
                item={item}
                actions={
                  <button
                    onClick={() => void handleRemove(item.id)}
                    className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-clay/10 text-clay hover:bg-clay/20 transition-colors"
                  >
                    <XIcon /> {t('remove', locale)}
                  </button>
                }
              />
            ))
          )}
        </div>
      )}

      {/* ── Rejected tab ── */}
      {activeTab === 'rejected' && (
        <div className="space-y-2">
          {rejectedItems.length === 0 ? (
            <div className="text-xs text-ink-5 py-2">{t('emptyRejected', locale)}</div>
          ) : (
            rejectedItems.map((item) => (
              <KnowledgeItemCard
                key={item.id}
                item={item}
                actions={
                  <button
                    onClick={() => void handleRestore(item.id)}
                    className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                  >
                    <RestoreIcon /> {t('restore', locale)}
                  </button>
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
