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

  // The "Founder OS" dashboard renders its own NavRail (left icon rail) as
  // part of the design-system chrome. Skip the legacy ProjectSidebar on that
  // route so we don't double-stack navigation. All other routes continue to
  // use ProjectSidebar until they're individually ported to the new design.
  const fullBleed = pathname.includes(`/project/${projectId}/dashboard`);

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
