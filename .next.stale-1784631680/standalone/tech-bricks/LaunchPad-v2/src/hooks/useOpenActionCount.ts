'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Open (pending + edited) action count for a project. Powers the NavRail
 * Inbox badge. Cache is shared across every page that mounts NavRail, so
 * navigating between sections doesn't re-fetch. lp-actions-changed events
 * invalidate this via the QueryProvider bridge.
 */
export function useOpenActionCount(projectId: string): { count: number } {
  const { data } = useQuery<number>({
    queryKey: ['actions', projectId, 'count'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/actions?status=pending,edited&limit=1`,
      );
      if (!res.ok) return 0;
      const body = await res.json();
      // Iter-3 QA fix: API returns summary fields nested under data.summary,
      // and Postgres COUNT(*) serializes as BIGINT string via postgres.js.
      // Read from data.summary AND coerce to number. Previously the strict
      // typeof check fell through to 0, making the nav badge always read
      // "0 pending" even when 4 actions were pending in DB.
      const summary = body?.data?.summary ?? body?.summary;
      const toNum = (v: unknown): number => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      return toNum(summary?.pending) + toNum(summary?.edited);
    },
  });

  return { count: data ?? 0 };
}
