'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Count of knowledge ITEMS for a project — powers the NavRail "Know" badge.
 *
 * Counts graph entities (competitors, personas, technologies, risks, …) but
 * NOT the synthesized `your_startup` root, which represents the project itself
 * rather than a piece of knowledge. Shares the 'knowledge' query topic so the
 * QueryProvider bridge invalidates it on lp-knowledge-changed (Apply/Dismiss),
 * and the cache is shared across every page that mounts NavRail.
 */
export function useKnowledgeCount(projectId: string): { count: number } {
  const { data } = useQuery<number>({
    queryKey: ['knowledge', projectId, 'count'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/graph/${projectId}`);
      if (!res.ok) return 0;
      const body = await res.json();
      const payload = body?.data ?? body;
      const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
      return nodes.filter(
        (n: { node_type?: string }) => n.node_type !== 'your_startup',
      ).length;
    },
  });
  return { count: data ?? 0 };
}
