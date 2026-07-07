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
  // `locked` marks a Validation-Gate 1C check that isn't actionable yet (1A+1B
  // still open) — StageCard renders it with a lock glyph instead of a CTA.
  result: { passed: boolean; evidence?: string; gap?: string; proof?: string; locked?: boolean };
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
    // SINGLE source of truth for ['stages', projectId]. Every consumer
    // (SpineSection, useCurrentSubtask, ScorePanel, StageCard) goes through
    // THIS hook so the cache holds ONE shape — the sorted evaluations array.
    // A past regression had StageCard/ScorePanel cache the raw payload OBJECT
    // under the same key; whichever mounted first poisoned the other's cache
    // (`.find is not a function`). Do NOT add a competing useQuery on this key
    // with a different shape — reuse useStages instead.
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
