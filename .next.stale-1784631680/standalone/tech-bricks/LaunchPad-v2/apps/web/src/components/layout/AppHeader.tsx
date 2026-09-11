'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function getProjectName(pathname: string): string | null {
  const match = pathname.match(/^\/project\/([^/]+)/);
  return match ? match[1] : null;
}

export default function AppHeader() {
  const pathname = usePathname();
  const projectId = getProjectName(pathname || '');

  return (
    <header className="h-12 border-b border-line bg-paper flex items-center px-6 shrink-0">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-moss to-plum flex items-center justify-center">
          <span className="text-on-accent text-xs font-bold">S</span>
        </div>
        <span className="text-ink font-semibold tracking-tight text-sm">SenseFound</span>
      </Link>
      {projectId && (
        <span className="ml-3 text-ink-6 text-sm">/</span>
      )}
    </header>
  );
}
