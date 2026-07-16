'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

function getProjectName(pathname: string): string | null {
  const match = pathname.match(/^\/project\/([^/]+)/);
  return match ? match[1] : null;
}

// Routes that render their own full-bleed design-system chrome (TopBar +
// NavRail) and therefore don't need the legacy AppHeader. Every page under
// /project/{id}/* now owns its chrome — the per-section allowlist was a
// migration leftover that left today/knowledge/usage/monitors with a
// duplicate "SenseFound /" bar stacked on top of the TopBar.
function isFullBleedRoute(pathname: string): boolean {
  if (pathname === '/' || pathname === '/settings' || pathname === '/demo') return true;
  return /^\/project\/[^/]+/.test(pathname);
}

export default function AppHeader() {
  const pathname = usePathname() || '';
  const projectId = getProjectName(pathname);

  if (isFullBleedRoute(pathname)) {
    return null;
  }

  return (
    <header className="h-12 border-b border-line bg-surface-sunk flex items-center px-6 shrink-0">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-moss to-plum flex items-center justify-center">
          <span className="text-paper text-xs font-bold">L</span>
        </div>
        <span className="text-ink font-semibold tracking-tight text-sm">LaunchPad</span>
      </Link>
      {projectId && (
        <span className="ml-3 text-ink-6 text-sm">/</span>
      )}
    </header>
  );
}
