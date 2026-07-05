'use client';

import { use } from 'react';
import { usePathname } from 'next/navigation';
import { useProject } from '@/hooks/useProject';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { ChromeProvider, useChromeState } from '@/components/design/chrome-context';
import { TopBar, NavRail } from '@/components/design/chrome';

/**
 * Project layout — owns the PERSISTENT chrome (TopBar + NavRail) plus the
 * project-loading gate.
 *
 * Locale note: the UI language is ACCOUNT-wide — it's governed by the
 * cookie-seeded LocaleProvider in the ROOT layout (src/app/layout.tsx), which
 * the language switch updates. This layout deliberately does NOT mount its own
 * provider: an inner one seeded from `project.locale` used to shadow the
 * account locale, so the switch appeared to do nothing on project pages.
 * `project.locale` is still the AGENT's per-project output language, resolved
 * server-side (resolveProjectLocale) — independent of the UI.
 *
 * The chrome lives here (not in each page) so it survives tab navigation: only
 * the content slot re-mounts (keyed on pathname) and crossfades via lp-rise,
 * while TopBar/NavRail stay mounted — no flicker, preserved state.
 * Per-page bits (breadcrumb, TopBar right-content, chat streaming) flow up
 * through ChromeProvider: pages call useSetChrome(...).
 */

// Fallback breadcrumb tail by route segment, used until (or if) a page publishes
// its own via useSetChrome — avoids a one-frame blank on first paint.
const FALLBACK_CRUMB: Record<string, string> = {
  today: 'Home', actions: 'Inbox', knowledge: 'Knowledge', chat: 'Co-pilot', usage: 'Usage',
};

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

  return (
    <ChromeProvider>
      <ProjectChrome projectId={projectId} projectName={project.name}>
        {children}
      </ProjectChrome>
    </ChromeProvider>
  );
}

function ProjectChrome({
  projectId,
  projectName,
  children,
}: {
  projectId: string;
  projectName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() || '';
  const seg = pathname.split('/')[3] ?? ''; // /project/<id>/<seg>
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const chrome = useChromeState();

  const breadcrumb =
    chrome.breadcrumb ?? ['Project', FALLBACK_CRUMB[seg] ?? projectName ?? ''];

  return (
    <div className="lp-frame">
      <TopBar projectId={projectId} breadcrumb={breadcrumb} right={chrome.right} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* current is inferred from pathname (NavRail.isActive matches item.route
            against the URL), so no per-page `current` prop is needed. */}
        <NavRail projectId={projectId} inboxBadge={inboxBadge} chatStreaming={chrome.chatStreaming} />
        {/* Content slot: re-mounts on tab change (key) and crossfades in. The
            chrome above/around it stays mounted. display:flex so multi-column
            pages (chat = column + canvas) and single-column pages both fit. */}
        <div key={pathname} className="lp-rise" style={{ flex: 1, minWidth: 0, display: 'flex', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
