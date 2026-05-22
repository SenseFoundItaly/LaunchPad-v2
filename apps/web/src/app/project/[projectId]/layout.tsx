'use client';

import { use } from 'react';
import { useProject } from '@/hooks/useProject';
import AppHeader from '@/components/layout/AppHeader';

function LoadingSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="rounded-full bg-danger/10 p-4">
        <svg className="h-8 w-8 text-danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <div>
        <h3 className="font-semibold text-foreground">Something went wrong</h3>
        <p className="mt-1 text-sm text-foreground-secondary">{message}</p>
      </div>
      <a
        href="/"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Back to Home
      </a>
    </div>
  );
}

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
      <div className="flex h-full flex-col bg-background">
        <AppHeader />
        <main className="flex-1">
          <LoadingSpinner />
        </main>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex h-full flex-col bg-background">
        <AppHeader />
        <main className="flex-1 p-6">
          <ErrorState message={error || 'Project not found'} />
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <AppHeader />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
