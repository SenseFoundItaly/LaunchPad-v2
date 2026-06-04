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
