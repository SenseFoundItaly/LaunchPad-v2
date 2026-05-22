'use client';

import { useState, useEffect, useCallback } from 'react';
import type { IntelligenceBrief } from '@/types';

/**
 * Fetches active intelligence briefs for a project.
 * Re-fetches on mount and when `lp-actions-changed` fires (which
 * happens after streaming ends or after an action is applied).
 */
export function useIntelligenceBriefs(projectId: string) {
  const [briefs, setBriefs] = useState<IntelligenceBrief[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/intelligence-briefs?status=active`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const data = body?.data ?? body;
      setBriefs(Array.isArray(data) ? data : []);
    } catch {
      setBriefs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
    const handler = () => refetch();
    window.addEventListener('lp-actions-changed', handler);
    return () => window.removeEventListener('lp-actions-changed', handler);
  }, [refetch]);

  return { briefs, loading };
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
