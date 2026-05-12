'use client';

import { useCallback, useEffect, useState } from 'react';

interface KnowledgeItem {
  id: string;
  type: 'fact' | 'graph_node' | 'tabular_review';
  title: string;
  detail: string | null;
  kind: string | null;
  reviewed_state: string;
  created_at: string;
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

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/knowledge?state=pending`);
      if (!res.ok) return;
      const json = await res.json();
      setItems(json.data?.items ?? []);
    } catch { /* non-fatal */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  async function handleReview(itemId: string, state: 'approved' | 'rejected') {
    // Optimistic update
    setItems((prev) => prev.filter((i) => i.id !== itemId));
    try {
      await fetch(`/api/projects/${projectId}/knowledge/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
    } catch {
      // Revert on error
      void fetchItems();
    }
  }

  async function handleApproveAll() {
    const ids = items.map((i) => i.id);
    setItems([]);
    for (const id of ids) {
      try {
        await fetch(`/api/projects/${projectId}/knowledge/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: 'approved' }),
        });
      } catch { /* best-effort */ }
    }
  }

  if (loading) {
    return <div className="text-xs text-zinc-500 py-2">Loading...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="text-xs text-zinc-500 py-2">
        No pending items
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
          onClick={() => void handleApproveAll()}
          className="text-[10px] px-2 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors font-medium"
        >
          Approve All
        </button>
      </div>

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
              onClick={() => void handleReview(item.id, 'approved')}
              className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors"
              title="Approve"
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
    </div>
  );
}
