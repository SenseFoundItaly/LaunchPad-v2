'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function RocketIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
    </svg>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  );
}

const NAV_ITEMS = [
  { path: 'idea', label: 'Idea' },
  { path: 'scoring', label: 'Scoring' },
  { path: 'research', label: 'Research' },
  { path: 'simulation', label: 'Simulation' },
  { path: 'workflow', label: 'Workflow' },
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'fundraising', label: 'Fundraising' },
  { path: 'journey', label: 'Journey' },
  { path: 'growth', label: 'Growth' },
  { path: 'drafts', label: 'Drafts' },
];

function getProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/project\/([^/]+)/);
  return match ? match[1] : null;
}

function getCurrentPath(pathname: string): string | null {
  const match = pathname.match(/^\/project\/[^/]+\/([^/]+)/);
  return match ? match[1] : null;
}

export default function AppHeader() {
  const pathname = usePathname();
  const projectId = getProjectId(pathname || '');
  const currentPath = getCurrentPath(pathname || '');

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-card/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <RocketIcon className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-semibold tracking-tight text-foreground">LaunchPad</span>
          </Link>
          {projectId && (
            <>
              <ChevronRightIcon className="h-4 w-4 text-foreground-muted" />
              <span className="text-sm text-foreground-secondary">Project</span>
            </>
          )}
        </div>

        {projectId && (
          <nav className="flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map((item) => {
              const isActive = currentPath === item.path;
              return (
                <Link
                  key={item.path}
                  href={`/project/${projectId}/${item.path}`}
                  className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground-secondary hover:bg-card-hover hover:text-foreground'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
