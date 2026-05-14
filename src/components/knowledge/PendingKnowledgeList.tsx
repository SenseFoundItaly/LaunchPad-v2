'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import type { ReviewedState } from '@/types/artifacts';

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

const TYPE_LABELS: Record<string, string> = {
  fact: 'Fact',
  graph_node: 'Entity',
  tabular_review: 'Review',
};

const TYPE_COLORS: Record<string, string> = {
  fact: 'bg-amber-500/20 text-amber-400',
  graph_node: 'bg-cyan-500/20 text-cyan-400',
  tabular_review: 'bg-violet-500/20 text-violet-400',
};

interface PendingKnowledgeListProps {
  projectId: string;
}

export default function PendingKnowledgeList({ projectId }: PendingKnowledgeListProps) {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);
  const [partialError, setPartialError] = useState<string | null>(null);
  const undoQueueRef = useRef(undoQueue);
  undoQueueRef.current = undoQueue;

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge?state=pending`);
      if (!res.ok) {
        console.warn(`[PendingKnowledgeList] fetch failed: HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setItems(json.data?.items ?? []);
    } catch (err) {
      console.warn('[PendingKnowledgeList] fetch error:', (err as Error).message);
    }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  async function handleReview(itemId: string, state: 'applied' | 'rejected') {
    const item = items.find((i) => i.id === itemId);
    // Optimistic update
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    setPartialError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Add to undo queue with 8s auto-dismiss
      if (item) {
        const timerId = setTimeout(() => {
          setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
        }, 8_000);
        setUndoQueue((prev) => [...prev, { item, state, timerId }]);
      }
    } catch (err) {
      console.warn('[PendingKnowledgeList] review failed, reverting:', (err as Error).message);
      void fetchItems();
    }
  }

  async function handleUndo(itemId: string) {
    const entry = undoQueueRef.current.find((u) => u.item.id === itemId);
    if (!entry) return;
    clearTimeout(entry.timerId);
    setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'pending' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Re-add to items list
      setItems((prev) => [entry.item, ...prev]);
    } catch (err) {
      console.warn('[PendingKnowledgeList] undo failed:', (err as Error).message);
    }
  }

  async function handleApplyAll() {
    setPartialError(null);
    const allItems = [...items];
    const ids = allItems.map((i) => i.id);
    setItems([]);
    let failCount = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'applied' }),
        });
        if (!res.ok) failCount++;
      } catch {
        failCount++;
      }
    }
    if (failCount > 0) {
      setPartialError(`${failCount} of ${ids.length} items failed to apply`);
      console.warn(`[PendingKnowledgeList] Apply All: ${failCount}/${ids.length} failed`);
      void fetchItems();
    } else {
      // Add all items to undo queue
      const timerId = setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => !ids.includes(u.item.id)));
      }, 8_000);
      setUndoQueue((prev) => [
        ...prev,
        ...allItems.map((item) => ({ item, state: 'applied' as const, timerId })),
      ]);
    }
  }

  if (loading) {
    return <div className="text-xs text-zinc-500 py-2">Loading...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        {partialError && (
          <div className="p-2 bg-red-950/40 border border-red-500/40 rounded text-[11px] text-red-300">
            {partialError}
          </div>
        )}
        <div className="text-xs text-zinc-500 py-2">
          No pending items
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">
          {items.length} pending item{items.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => void handleApplyAll()}
          className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors font-medium"
        >
          Apply All
        </button>
      </div>

      {partialError && (
        <div className="p-2 bg-red-950/40 border border-red-500/40 rounded text-[11px] text-red-300">
          {partialError}
        </div>
      )}

      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-2 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TYPE_COLORS[item.type] ?? 'bg-zinc-500/20 text-zinc-400'}`}>
                {TYPE_LABELS[item.type] ?? item.type}
              </span>
              {item.kind && item.kind !== 'review' && (
                <span className="text-[10px] text-zinc-500">{item.kind}</span>
              )}
            </div>
            <p className="text-xs text-zinc-200 truncate">{item.title}</p>
            {item.detail && (
              <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{item.detail}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 pt-0.5">
            <button
              onClick={() => void handleReview(item.id, 'applied')}
              className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
              title="Apply"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              onClick={() => void handleReview(item.id, 'rejected')}
              className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-500 hover:text-red-400 hover:bg-red-500/20 transition-colors"
              title="Reject"
            >
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      ))}

      {undoQueue.length > 0 && (
        <div className="space-y-1 pt-1">
          {undoQueue.map((entry) => (
            <div
              key={entry.item.id}
              className="flex items-center justify-between bg-zinc-700/40 border border-zinc-600 rounded px-2.5 py-1.5"
            >
              <span className="text-[10px] text-zinc-400 truncate flex-1 mr-2">
                {entry.state === 'applied' ? 'Applied' : 'Rejected'}: {entry.item.title}
              </span>
              <button
                onClick={() => void handleUndo(entry.item.id)}
                className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors font-medium flex-shrink-0"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
