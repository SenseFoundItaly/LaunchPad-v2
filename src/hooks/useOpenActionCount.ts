'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Lightweight polling hook that returns the number of open (pending + edited)
 * actions for a project. Used by NavRail to show an inbox badge.
 *
 * - Fetches summary counts from GET /api/projects/{id}/actions?status=pending,edited&limit=1
 * - Refetches on `lp-actions-changed` window event
 * - Refetches every 60s
 */
export function useOpenActionCount(projectId: string): { count: number } {
  const [count, setCount] = useState(0);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/projects/${projectId}/actions?status=pending,edited&limit=1`,
      );
      if (!res.ok) return;
      const body = await res.json();
      const summary = body?.summary;
      const n = (typeof summary?.pending === 'number' ? summary.pending : 0)
        + (typeof summary?.edited === 'number' ? summary.edited : 0);
      setCount(n);
    } catch {
      // Silently ignore — badge just won't update
    }
  }, [projectId]);

  useEffect(() => {
    refetch();

    // Event-driven refetch
    const handler = () => refetch();
    window.addEventListener('lp-actions-changed', handler);

    // Polling fallback
    const interval = setInterval(refetch, 60_000);

    return () => {
      window.removeEventListener('lp-actions-changed', handler);
      clearInterval(interval);
    };
  }, [refetch]);

  return { count };
}
