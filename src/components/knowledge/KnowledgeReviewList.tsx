'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
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

export interface KnowledgeReviewListProps {
  projectId: string;
  locale: 'en' | 'it';
  /** compact mode hides tabs and shows only pending items — used in sidebar */
  compact?: boolean;
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
  tabProposals:       { en: 'Proposals',  it: 'Proposte' },
  tabInContext:       { en: 'In Context', it: 'In contesto' },
  tabRejected:        { en: 'Rejected',   it: 'Rifiutati' },
  approve:            { en: 'Approve',    it: 'Approva' },
  reject:             { en: 'Reject',     it: 'Rifiuta' },
  remove:             { en: 'Remove',     it: 'Rimuovi' },
  restore:            { en: 'Restore',    it: 'Ripristina' },
  applyAll:           { en: 'Apply All',  it: 'Applica tutto' },
  undo:               { en: 'Undo',       it: 'Annulla' },
  emptyPending:       { en: 'No pending proposals',    it: 'Nessuna proposta in attesa' },
  emptyApplied:       { en: 'No items in context yet', it: 'Nessun elemento nel contesto' },
  emptyRejected:      { en: 'No rejected items',       it: 'Nessun elemento rifiutato' },
  applied:            { en: 'Applied',    it: 'Applicato' },
  rejected:           { en: 'Rejected',   it: 'Rifiutato' },
  loading:            { en: 'Loading\u2026', it: 'Caricamento\u2026' },
  warningBanner:      {
    en: 'This will be added to your project\u2019s intelligence and inform future AI responses.',
    it: 'Questo verr\u00e0 aggiunto all\u2019intelligence del progetto e influenzer\u00e0 le risposte future dell\u2019AI.',
  },
  viewIntelligence:   { en: 'View Intelligence \u2192', it: 'Vedi Intelligence \u2192' },
  knowledgeProposals: { en: 'AI Knowledge Proposals',   it: 'Proposte di conoscenza AI' },
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

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    style={{ transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}
  >
    <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const InfoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0 }}>
    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6 5.5V8.5M6 3.5V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

// =============================================================================
// KnowledgeItemCard — expandable accordion card
// =============================================================================

function KnowledgeItemCard({
  item,
  isExpanded,
  onToggle,
  actions,
}: {
  item: KnowledgeItem;
  isExpanded: boolean;
  onToggle: () => void;
  actions: React.ReactNode;
}) {
  return (
    <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Collapsed header — always visible */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 10,
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--paper-2)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[item.type] ?? 'bg-ink-5/20 text-ink-4'}`}>
          {TYPE_LABELS[item.type] ?? item.type}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: 'var(--ink-2)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {item.title}
        </span>
        <ChevronIcon open={isExpanded} />
      </div>

      {/* Expanded detail + actions */}
      {isExpanded && (
        <div style={{ padding: '0 10px 10px', borderTop: '1px solid var(--line)' }}>
          {item.detail && (
            <p style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.5, margin: '8px 0' }}>
              {item.detail}
            </p>
          )}
          {item.kind && item.kind !== 'review' && (
            <p
              className="lp-mono"
              style={{ fontSize: 10, color: 'var(--ink-5)', margin: '4px 0 8px' }}
            >
              {item.kind}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 4 }}>
            {actions}
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Warning banner
// =============================================================================

function IntelligenceWarning({ locale }: { locale: 'en' | 'it' }) {
  return (
    <div className="text-[11px] text-ink-4 bg-accent/5 border border-accent/20 rounded-lg px-3 py-2"
      style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}
    >
      <InfoIcon />
      <span>{t('warningBanner', locale)}</span>
    </div>
  );
}

// =============================================================================
// Main component
// =============================================================================

export default function KnowledgeReviewList({ projectId, locale, compact }: KnowledgeReviewListProps) {
  const [activeTab, setActiveTab] = useState<KnowledgeTab>('pending');
  const [pendingItems, setPendingItems] = useState<KnowledgeItem[]>([]);
  const [appliedItems, setAppliedItems] = useState<KnowledgeItem[]>([]);
  const [rejectedItems, setRejectedItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        console.warn(`[KnowledgeReviewList] fetch ${tab} failed: HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      const data: KnowledgeItem[] = json.data?.items ?? [];
      if (tab === 'pending') setPendingItems(data);
      else if (tab === 'applied') setAppliedItems(data);
      else setRejectedItems(data);
    } catch (err) {
      console.warn(`[KnowledgeReviewList] fetch ${tab} error:`, (err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchItemsForTab('pending').finally(() => setLoading(false));
  }, [fetchItemsForTab]);

  function handleTabClick(tab: KnowledgeTab) {
    setActiveTab(tab);
    setExpandedId(null);
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
    setExpandedId(null);
    setPartialError(null);
    try {
      await patchItem(itemId, 'applied');
      const timerId = setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
      }, 8_000);
      setUndoQueue((prev) => [...prev, { item, state: 'applied', timerId }]);
    } catch (err) {
      console.warn('[KnowledgeReviewList] approve failed, reverting:', (err as Error).message);
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
    setExpandedId(null);
    setPartialError(null);
    try {
      await patchItem(itemId, 'rejected');
      const timerId = setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
      }, 8_000);
      setUndoQueue((prev) => [...prev, { item, state: 'rejected', timerId }]);
    } catch (err) {
      console.warn('[KnowledgeReviewList] reject failed, reverting:', (err as Error).message);
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
    setExpandedId(null);
    try {
      await patchItem(itemId, 'rejected');
    } catch (err) {
      console.warn('[KnowledgeReviewList] remove failed, reverting:', (err as Error).message);
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
    setExpandedId(null);
    try {
      await patchItem(itemId, 'pending');
    } catch (err) {
      console.warn('[KnowledgeReviewList] restore failed, reverting:', (err as Error).message);
      void fetchItemsForTab('rejected');
      void fetchItemsForTab('pending');
    }
  }

  // ---------------------------------------------------------------------------
  // Undo
  // ---------------------------------------------------------------------------

  async function handleUndo(itemId: string) {
    const entry = undoQueueRef.current.find((u) => u.item.id === itemId);
    if (!entry) return;
    clearTimeout(entry.timerId);
    setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
    if (entry.state === 'applied' && loadedTabs.current.has('applied')) {
      setAppliedItems((prev) => prev.filter((i) => i.id !== itemId));
    }
    if (entry.state === 'rejected' && loadedTabs.current.has('rejected')) {
      setRejectedItems((prev) => prev.filter((i) => i.id !== itemId));
    }
    setPendingItems((prev) => [entry.item, ...prev]);
    try {
      await patchItem(itemId, 'pending');
    } catch (err) {
      console.warn('[KnowledgeReviewList] undo failed:', (err as Error).message);
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
    setExpandedId(null);
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
  // Tab config (full mode only)
  // ---------------------------------------------------------------------------

  const tabs: { key: KnowledgeTab; label: string; count: number }[] = [
    { key: 'pending',  label: t('tabProposals', locale), count: pendingItems.length },
    { key: 'applied',  label: t('tabInContext', locale),  count: appliedItems.length },
    { key: 'rejected', label: t('tabRejected', locale),   count: rejectedItems.length },
  ];

  // ---------------------------------------------------------------------------
  // Determine which items + actions to render
  // ---------------------------------------------------------------------------

  const currentItems = compact
    ? pendingItems
    : activeTab === 'pending'
      ? pendingItems
      : activeTab === 'applied'
        ? appliedItems
        : rejectedItems;

  const currentTab = compact ? 'pending' : activeTab;

  const emptyKey = currentTab === 'pending'
    ? 'emptyPending'
    : currentTab === 'applied'
      ? 'emptyApplied'
      : 'emptyRejected';

  const showApplyAll = currentTab === 'pending' && pendingItems.length > 1;
  const showUndoQueue = (currentTab === 'pending' || compact) && undoQueue.length > 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return <div className="text-xs text-ink-5 py-2">{t('loading', locale)}</div>;
  }

  // Compact: skip rendering entirely if no pending items and no undo queue
  if (compact && pendingItems.length === 0 && undoQueue.length === 0) {
    return null;
  }

  function renderActions(item: KnowledgeItem) {
    if (currentTab === 'pending') {
      return (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); void handleApprove(item.id); }}
            className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-moss-wash text-moss hover:bg-moss/30 transition-colors"
          >
            <CheckIcon /> {t('approve', locale)}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); void handleReject(item.id); }}
            className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-paper-3/50 text-ink-5 hover:text-clay hover:bg-clay/20 transition-colors"
          >
            <XIcon /> {t('reject', locale)}
          </button>
        </>
      );
    }
    if (currentTab === 'applied') {
      return (
        <button
          onClick={(e) => { e.stopPropagation(); void handleRemove(item.id); }}
          className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-clay/10 text-clay hover:bg-clay/20 transition-colors"
        >
          <XIcon /> {t('remove', locale)}
        </button>
      );
    }
    // rejected
    return (
      <button
        onClick={(e) => { e.stopPropagation(); void handleRestore(item.id); }}
        className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5 bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
      >
        <RestoreIcon /> {t('restore', locale)}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      {/* Tab bar (full mode only) */}
      {!compact && (
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
      )}

      {partialError && (
        <div className="p-2 bg-clay/10 border border-clay/40 rounded text-[11px] text-clay">
          {partialError}
        </div>
      )}

      {/* Intelligence warning banner (pending tab / compact) */}
      {currentTab === 'pending' && currentItems.length > 0 && (
        <IntelligenceWarning locale={locale} />
      )}

      {/* Apply All button */}
      {showApplyAll && (
        <div className="flex items-center justify-end">
          <button
            onClick={() => void handleApplyAll()}
            className="text-xs px-3 py-1 rounded bg-moss-wash text-moss hover:bg-moss/30 transition-colors font-medium"
          >
            {t('applyAll', locale)}
          </button>
        </div>
      )}

      {/* Item cards */}
      {currentItems.length === 0 ? (
        <div className="text-xs text-ink-5 py-2">{t(emptyKey, locale)}</div>
      ) : (
        currentItems.map((item) => (
          <KnowledgeItemCard
            key={item.id}
            item={item}
            isExpanded={expandedId === item.id}
            onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
            actions={renderActions(item)}
          />
        ))
      )}

      {/* Undo queue */}
      {showUndoQueue && (
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

      {/* View Intelligence CTA — repointed to /signals (briefs surface) */}
      <div style={{ paddingTop: 4 }}>
        <Link
          href={`/project/${projectId}/signals`}
          className="text-xs text-accent-ink font-medium"
          style={{ textDecoration: 'none' }}
        >
          {t('viewIntelligence', locale)}
        </Link>
      </div>
    </div>
  );
}
