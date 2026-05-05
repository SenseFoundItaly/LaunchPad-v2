'use client';

import { use } from 'react';
import { usePathname } from 'next/navigation';
import { useProject } from '@/hooks/useProject';
import ProjectSidebar from '@/components/layout/ProjectSidebar';

export default function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { project, loading, error } = useProject(projectId);
  const pathname = usePathname() || '';

  // Routes that render their own full-bleed design-system chrome (TopBar +
  // NavRail + StatusBar) — skip the legacy ProjectSidebar for these so we
  // don't double-stack navigation. Extend this list as more pages port to
  // the new design.
  const fullBleedRoutes = ['dashboard', 'actions', 'chat', 'intelligence', 'workflow', 'org', 'signals'];
  const fullBleed = fullBleedRoutes.some((r) =>
    pathname.includes(`/project/${projectId}/${r}`),
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Loading...
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        {error || 'Project not found'}
      </div>
    );
  }

  if (fullBleed) {
    return <div className="h-full">{children}</div>;
  }

  return (
    <div className="flex h-full">
      <ProjectSidebar projectId={projectId} projectName={project.name} />
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
