'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingAction } from '@/types';
import { actionToInbox, factToInbox, type KnowledgeRow } from './adapters';
import type { InboxItem } from './types';

// Both endpoints wrap responses via `json()` from api-helpers as
// { success: true, data: <payload> } — easy to miss because TypeScript will
// happily lie about the shape via `as` casts.
interface ActionsResponse {
  success?: boolean;
  data?: { actions?: PendingAction[]; summary?: { pending: number; edited: number } };
  // Allow flat shape too in case any caller bypasses json() in the future.
  actions?: PendingAction[];
}

interface KnowledgeResponse {
  success?: boolean;
  data?: { items?: KnowledgeRow[]; pending_count?: number };
  items?: KnowledgeRow[];
}

interface UseInboxResult {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const POLL_MS = 30_000;

export function useInbox(projectId: string): UseInboxResult {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const [actionsRes, knowledgeRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/actions?status=pending,edited&limit=50`),
        fetch(`/api/projects/${projectId}/knowledge?state=pending`),
      ]);

      const actionsBody = actionsRes.ok ? ((await actionsRes.json()) as ActionsResponse) : null;
      const knowledgeBody = knowledgeRes.ok ? ((await knowledgeRes.json()) as KnowledgeResponse) : null;
      const actions: PendingAction[] =
        actionsBody?.data?.actions ?? actionsBody?.actions ?? [];
      const knowledge: KnowledgeRow[] =
        knowledgeBody?.data?.items ?? knowledgeBody?.items ?? [];

      if (!aliveRef.current) return;

      const merged: InboxItem[] = [
        ...actions.map(actionToInbox),
        ...knowledge.map(factToInbox),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      setItems(merged);
    } catch (err) {
      if (!aliveRef.current) return;
      setError((err as Error).message);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    aliveRef.current = true;
    void refetch();
    const onChange = () => { void refetch(); };
    window.addEventListener('lp-actions-changed', onChange);
    const intervalId = window.setInterval(() => { void refetch(); }, POLL_MS);
    return () => {
      aliveRef.current = false;
      window.removeEventListener('lp-actions-changed', onChange);
      window.clearInterval(intervalId);
    };
  }, [refetch]);

  return { items, loading, error, refetch };
}
