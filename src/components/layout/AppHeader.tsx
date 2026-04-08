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
    <header className="h-12 border-b border-zinc-800 bg-zinc-950 flex items-center px-6 shrink-0">
      <Link href="/" className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center">
          <span className="text-white text-xs font-bold">L</span>
        </div>
        <span className="text-white font-semibold tracking-tight text-sm">LaunchPad</span>
      </Link>
      {projectId && (
        <span className="ml-3 text-zinc-600 text-sm">/</span>
      )}
    </header>
  );
}
