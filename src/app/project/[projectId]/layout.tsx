'use client';

import { use } from 'react';
import { useProject } from '@/hooks/useProject';

/**
 * Project layout — minimal guard. Each project page renders its own
 * TopBar + NavRail + StatusBar chrome, so the layout's only job is the
 * project-loading + not-found gate. The legacy ProjectSidebar (and its
 * 7-stage skill nav) was retired in the v2 simplification.
 */
export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId: _projectId } = use(params);
  const { project, loading, error } = useProject(_projectId);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-ink-5 text-sm">
        Loading...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full text-ink-5 text-sm">
        {error || 'Project not found'}
      </div>
    );
  }

  return <div className="h-full">{children}</div>;
}
