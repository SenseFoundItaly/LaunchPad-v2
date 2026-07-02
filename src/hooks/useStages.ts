'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * Shared journey-pipeline query (GET /api/projects/{id}/stages).
 *
 * Both the Co-pilot canvas spine (SpineSection) and the chat header subtitle
 * (useCurrentSubtask) need this data. Routing them through ONE hook with ONE
 * queryKey (['stages', projectId]) means TanStack dedupes them into a single
 * cached network request — instead of two components each re-fetching /stages
 * on every mount. The 'stages' topic is invalidated by the lp-actions-changed
 * bridge, so the pipeline still refreshes as the founder clears substeps.
 */

export interface StageCheckRow {
  check: { id: string; label: string; source?: string; track?: '1A' | '1B' | '1C' };
  result: { passed: boolean; evidence?: string; gap?: string; proof?: string };
}

export interface StageEvaluation {
  stage: { id: string; number: number; label: string; tagline?: string };
  passed: number;
  total: number;
  status: 'done' | 'active' | 'pending';
  results: StageCheckRow[];
}

export function useStages(projectId: string) {
  return useQuery<StageEvaluation[]>({
    queryKey: ['stages', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/stages`);
      const body = await res.json();
      const inner = body?.data ?? body;
      const list: StageEvaluation[] = Array.isArray(inner?.evaluations) ? inner.evaluations : [];
      list.sort((a, b) => a.stage.number - b.stage.number);
      return list;
    },
  });
}
