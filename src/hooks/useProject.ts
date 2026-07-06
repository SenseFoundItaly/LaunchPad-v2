'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { getProject } from '@/api/projects';
import type { Project } from '@/types';

export function useProject(projectId: string) {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery<Project | null>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
    enabled: !!projectId,
    // This query gates the whole project layout — with staleTime: Infinity a
    // failed fetch would otherwise stick for the session, so retry harder
    // than the default. 4xx still short-circuits via the provider's
    // status-aware retry (a boolean here would override it).
    retry: (failureCount, err) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) return false;
      return failureCount < 3;
    },
  });

  const refresh = useCallback(
    () => qc.invalidateQueries({ queryKey: ['project', projectId] }),
    [qc, projectId],
  );

  return {
    project: data ?? null,
    loading: isLoading,
    error: error instanceof Error ? error.message : null,
    refresh,
  };
}
