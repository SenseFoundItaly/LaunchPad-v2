'use client';

import { useQuery } from '@tanstack/react-query';

/**
 * The founder's recorded Validation-Gate call (GET /api/projects/{id}/gate-verdict).
 *
 * Separate from useStages on purpose: that hook's cache entry is pinned to the
 * sorted evaluations ARRAY, and a past regression proved what happens when two
 * consumers cache different shapes under one key. This is its own key, its own
 * shape.
 *
 * Consumed by SpineSection to decide which exit the founder is offered — the
 * one thing the check row cannot tell it, since `gate_verdict` reads
 * `passed: false` for "not decided", "pivoted" and "stopped" alike.
 */

export type GateVerdictValue = 'GO' | 'PIVOT' | 'STOP';

export interface GateVerdictRecord {
  verdict: GateVerdictValue;
  decided_at?: string;
  motivation?: string;
  scope?: '1A' | '1B' | '1C' | null;
}

export function useGateVerdict(projectId: string) {
  return useQuery<GateVerdictRecord | null>({
    queryKey: ['gate-verdict', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/gate-verdict`);
      // Fail CLOSED to null rather than throwing: this hook only decides which
      // secondary affordance to show. A blip must not take the checklist down
      // with it — the founder still sees a working spine, just without the
      // reopen link until the next refetch.
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      const inner = body?.data ?? body;
      const gv = inner?.gate_verdict;
      return gv && typeof gv === 'object' && typeof gv.verdict === 'string'
        ? (gv as GateVerdictRecord)
        : null;
    },
  });
}
