'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Count of knowledge ITEMS for a project — powers the NavRail "Knowledge" badge.
 *
 * Reads the canonical applied-knowledge total from
 * /api/projects/{id}/knowledge-count (countAppliedKnowledge: applied non-root
 * graph nodes + applied facts, uncapped). This is the SAME number the Canvas
 * "Knowledge — N elementi" row shows, so the sidebar and the canvas agree —
 * previously this hook counted ALL graph nodes (applied AND pending, no facts)
 * straight off /api/graph, which disagreed with the canvas (e.g. 11 vs 9).
 *
 * Keeps the 'knowledge' query topic so the QueryProvider bridge invalidates it
 * on lp-knowledge-changed (Apply/Dismiss), and the cache is shared across every
 * page that mounts NavRail.
 */
export function useKnowledgeCount(projectId: string): { count: number } {
  const { data } = useQuery<number>({
    queryKey: ['knowledge', projectId, 'count'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/knowledge-count`);
      if (!res.ok) return 0;
      const body = await res.json();
      const payload = body?.data ?? body;
      return typeof payload?.count === 'number' ? payload.count : 0;
    },
  });
  return { count: data ?? 0 };
}
