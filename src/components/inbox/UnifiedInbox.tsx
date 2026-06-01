'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInbox } from '@/lib/inbox/useInbox';
import { applyInboxItem, rejectInboxItem, restoreInboxItem } from '@/lib/inbox/adapters';
import type { InboxItem } from '@/lib/inbox/types';
import { UnifiedInboxItem } from './UnifiedInboxItem';

interface UnifiedInboxProps {
  projectId: string;
  locale: 'en' | 'it';
  onCountChange?: (n: number) => void;
}

interface UndoEntry {
  item: InboxItem;
  state: 'applied' | 'rejected';
  timerId: number;
}

const UNDO_TTL_MS = 8_000;

const STRINGS = {
  empty:     { en: 'Nothing pending — all caught up.', it: 'Nulla in sospeso.' },
  loading:   { en: 'Loading…',                          it: 'Caricamento…' },
  applyAll:  { en: 'Apply all knowledge proposals',     it: 'Applica tutte le proposte di conoscenza' },
  applied:   { en: 'Applied',                           it: 'Applicato' },
  rejected:  { en: 'Rejected',                          it: 'Rifiutato' },
  undo:      { en: 'Undo',                              it: 'Annulla' },
  partialFail: {
    en: (n: number, total: number) => `${n} of ${total} items failed to apply`,
    it: (n: number, total: number) => `${n} di ${total} elementi non applicati`,
  },
};

function t(key: 'empty' | 'loading' | 'applyAll' | 'applied' | 'rejected' | 'undo', locale: 'en' | 'it'): string {
  return STRINGS[key][locale];
}

export function UnifiedInbox({ projectId, locale, onCountChange }: UnifiedInboxProps) {
  const { items, loading, error, refetch } = useInbox(projectId);

  const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());
  const [partialError, setPartialError] = useState<string | null>(null);

  const undoQueueRef = useRef(undoQueue);
  useEffect(() => {
    undoQueueRef.current = undoQueue;
  }, [undoQueue]);

  const visibleItems = items.filter((it) => !hiddenIds.has(it.id));

  useEffect(() => {
    onCountChange?.(visibleItems.length);
  }, [visibleItems.length, onCountChange]);

  const hideOptimistic = useCallback((itemId: string) => {
    setHiddenIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }, []);

  const unhide = useCallback((itemId: string) => {
    setHiddenIds((prev) => {
      if (!prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  }, []);

  const pushUndo = useCallback((item: InboxItem, state: 'applied' | 'rejected') => {
    if (item.source !== 'fact') return;
    const timerId = window.setTimeout(() => {
      setUndoQueue((prev) => prev.filter((u) => u.item.id !== item.id));
    }, UNDO_TTL_MS);
    setUndoQueue((prev) => [...prev, { item, state, timerId }]);
  }, []);

  const handleApply = useCallback(async (item: InboxItem) => {
    hideOptimistic(item.id);
    try {
      await applyInboxItem(item, projectId);
      pushUndo(item, 'applied');
    } catch (err) {
      unhide(item.id);
      throw err;
    }
  }, [projectId, hideOptimistic, unhide, pushUndo]);

  const handleReject = useCallback(async (item: InboxItem) => {
    hideOptimistic(item.id);
    try {
      await rejectInboxItem(item, projectId);
      pushUndo(item, 'rejected');
    } catch (err) {
      unhide(item.id);
      throw err;
    }
  }, [projectId, hideOptimistic, unhide, pushUndo]);

  const handleUndo = useCallback(async (itemId: string) => {
    const entry = undoQueueRef.current.find((u) => u.item.id === itemId);
    if (!entry) return;
    window.clearTimeout(entry.timerId);
    setUndoQueue((prev) => prev.filter((u) => u.item.id !== itemId));
    try {
      await restoreInboxItem(entry.item, projectId);
      unhide(itemId);
      void refetch();
    } catch (err) {
      console.warn('[UnifiedInbox] undo failed:', (err as Error).message);
    }
  }, [projectId, unhide, refetch]);

  const factPendingCount = visibleItems.filter((it) => it.source === 'fact').length;
  const showApplyAll = factPendingCount >= 2;

  const handleApplyAll = useCallback(async () => {
    setPartialError(null);
    const facts = visibleItems.filter((it) => it.source === 'fact');
    if (facts.length === 0) return;
    facts.forEach((it) => hideOptimistic(it.id));
    let failures = 0;
    for (const item of facts) {
      try {
        await applyInboxItem(item, projectId);
      } catch {
        failures++;
        unhide(item.id);
      }
    }
    if (failures > 0) {
      setPartialError(STRINGS.partialFail[locale](failures, facts.length));
    } else {
      const timerId = window.setTimeout(() => {
        setUndoQueue((prev) => prev.filter((u) => !facts.some((f) => f.id === u.item.id)));
      }, UNDO_TTL_MS);
      setUndoQueue((prev) => [
        ...prev,
        ...facts.map((item): UndoEntry => ({ item, state: 'applied', timerId })),
      ]);
    }
  }, [visibleItems, projectId, locale, hideOptimistic, unhide]);

  useEffect(() => {
    return () => {
      undoQueueRef.current.forEach((entry) => window.clearTimeout(entry.timerId));
    };
  }, []);

  if (loading && items.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-5)', textAlign: 'center', padding: 40 }}>
        {t('loading', locale)}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontSize: 12, color: 'var(--clay)', textAlign: 'center', padding: 12 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {partialError && (
        <div
          style={{
            padding: 8,
            background: 'color-mix(in srgb, var(--clay) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--clay) 40%, transparent)',
            borderRadius: 4,
            fontSize: 11,
            color: 'var(--clay)',
          }}
        >
          {partialError}
        </div>
      )}

      {showApplyAll && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={() => void handleApplyAll()}
            className="text-xs px-3 py-1 rounded bg-moss-wash text-moss hover:bg-moss/30 transition-colors font-medium"
          >
            {t('applyAll', locale)} ({factPendingCount})
          </button>
        </div>
      )}

      {visibleItems.length === 0 && undoQueue.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
            color: 'var(--ink-4)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, lineHeight: 1.5 }}>{t('empty', locale)}</p>
        </div>
      )}

      {visibleItems.map((item) => (
        <UnifiedInboxItem
          key={item.id}
          item={item}
          onApply={handleApply}
          onReject={handleReject}
          locale={locale}
        />
      ))}

      {undoQueue.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
          {undoQueue.map((entry) => (
            <div
              key={entry.item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'color-mix(in srgb, var(--paper-3) 40%, transparent)',
                border: '1px solid var(--line)',
                borderRadius: 4,
                padding: '6px 10px',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--ink-4)',
                  flex: 1,
                  marginRight: 8,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(entry.state, locale)}: {entry.item.title}
              </span>
              <button
                onClick={() => void handleUndo(entry.item.id)}
                className="text-[10px] px-2 py-0.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors font-medium"
                style={{ flexShrink: 0 }}
              >
                {t('undo', locale)}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
