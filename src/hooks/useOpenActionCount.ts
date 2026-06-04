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
      const summary = body?.summary;
      const pending = typeof summary?.pending === 'number' ? summary.pending : 0;
      const edited = typeof summary?.edited === 'number' ? summary.edited : 0;
      return pending + edited;
    },
  });

  return { count: data ?? 0 };
}
