'use client';

import { useQuery } from '@tanstack/react-query';
import type { IntelligenceBrief } from '@/types';

/**
 * Fetches active intelligence briefs for a project.
 *
 * Cached via TanStack under the 'briefs' topic so it survives tab navigation
 * (no refetch on remount). It refreshes only when the lp-actions-changed bridge
 * invalidates 'briefs' — e.g. after streaming ends or an action is applied.
 */
export function useIntelligenceBriefs(projectId: string) {
  const { data, isLoading } = useQuery<IntelligenceBrief[]>({
    queryKey: ['briefs', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/intelligence-briefs?status=active`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const list = body?.data ?? body;
      return Array.isArray(list) ? list : [];
    },
  });

  return { briefs: data ?? [], loading: isLoading };
}

/**
 * Match briefs against canvas entity-card artifacts.
 *
 * Scans the canvas for entity-card type artifacts, extracts their names,
 * and matches against `brief.entity_name` (case-insensitive). Returns
 * matched briefs sorted by confidence DESC.
 */
export function matchBriefs(
  briefs: IntelligenceBrief[],
  canvasEntries: Array<{ artifact: { type: string; id: string } }>,
): IntelligenceBrief[] {
  // Collect entity names from canvas
  const entityNames = new Set<string>();
  for (const entry of canvasEntries) {
    if (entry.artifact.type === 'entity-card') {
      const name = (entry.artifact as { name?: string }).name;
      if (name) entityNames.add(name.toLowerCase());
    }
  }

  if (entityNames.size === 0) return [];

  return briefs
    .filter((b) =>
      b.entity_name && entityNames.has(b.entity_name.toLowerCase()),
    )
    .sort((a, b) => b.confidence - a.confidence);
}
