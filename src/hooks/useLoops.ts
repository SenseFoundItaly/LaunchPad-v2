'use client';

import { useQuery } from '@tanstack/react-query';
import type { LoopRow } from '@/lib/loops/loop-display';

/**
 * useLoops — the project's validation loops (newest first) from GET /loops.
 *
 * Shares the ['loops', projectId] cache; invalidated by the same
 * `lp-actions-changed` / `lp-skills-changed` events the verdict + skill-run
 * paths already dispatch, so an approved review or recorded verdict refreshes
 * the loop UI without a manual refetch.
 */
export function useLoops(projectId: string) {
  return useQuery<LoopRow[]>({
    queryKey: ['loops', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/loops`);
      const body = await res.json();
      const data = body?.data ?? body;
      return Array.isArray(data) ? (data as LoopRow[]) : [];
    },
  });
}
