'use client';

/**
 * useResolvedActionStatus — tells an inline proposal card whether its
 * pending_action was ALREADY resolved (applied / sent / rejected / failed) on
 * a prior turn.
 *
 * Why: the Validation / Monitor / Budget proposal cards keep their applied
 * state in LOCAL useState. After a page reload the card re-mounts from the
 * persisted chat message and defaults back to its clickable "active" state
 * with no knowledge that the founder already approved it — so it looked
 * actionable, the founder clicked Apply, and (because the action was already
 * resolved) nothing changed in their project, and any inline edits they made
 * were silently dropped. This is the alpha-tester's "Apply mi scala il credito
 * ma non succede nulla" (changelog 3.4) after a refresh.
 *
 * One shared TanStack query per project (all cards dedupe onto it) fetches the
 * resolved rows and returns a map id → status. `materialize=false` keeps this a
 * pure read (materialization only ever creates PENDING rows, which this query
 * filters out anyway). Invalidated by the lp-actions-changed bridge so an
 * approve elsewhere reconciles the cards.
 */

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { extractResolvedMap, type ResolvedStatus } from '@/lib/resolved-action-status';

function projectIdFromParams(params: ReturnType<typeof useParams>): string {
  const p = params?.projectId;
  return typeof p === 'string' ? p : Array.isArray(p) ? p[0] ?? '' : '';
}

export function useResolvedActionStatus(pendingActionId: string | undefined): ResolvedStatus | undefined {
  const projectId = projectIdFromParams(useParams());
  const qc = useQueryClient();

  const { data } = useQuery<Record<string, ResolvedStatus>>({
    queryKey: ['resolved-actions', projectId],
    enabled: !!projectId,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/actions?status=applied,sent,rejected,failed&limit=200&materialize=false`,
      );
      if (!res.ok) return {};
      const body = await res.json().catch(() => null);
      return extractResolvedMap(body);
    },
  });

  // Reconcile when any action changes (approve on another surface, this card's
  // own apply). Bound once per mount; cheap no-op when nothing is listening.
  useEffect(() => {
    if (!projectId || typeof window === 'undefined') return;
    const handler = () => qc.invalidateQueries({ queryKey: ['resolved-actions', projectId] });
    window.addEventListener('lp-actions-changed', handler);
    return () => window.removeEventListener('lp-actions-changed', handler);
  }, [projectId, qc]);

  return pendingActionId ? data?.[pendingActionId] : undefined;
}
