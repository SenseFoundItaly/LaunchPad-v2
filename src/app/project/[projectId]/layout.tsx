'use client';

import { use } from 'react';
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

  return (
    <div className="flex h-full">
      <ProjectSidebar projectId={projectId} projectName={project.name} />
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}
