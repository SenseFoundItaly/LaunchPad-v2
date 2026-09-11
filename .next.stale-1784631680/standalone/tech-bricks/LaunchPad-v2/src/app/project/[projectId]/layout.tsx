'use client';

import { use } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useProject } from '@/hooks/useProject';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { ChromeProvider, useChromeState } from '@/components/design/chrome-context';
import { TopBar, NavRail } from '@/components/design/chrome';
import { LocaleProvider, useT } from '@/components/providers/LocaleProvider';
import { asLocale } from '@/lib/i18n/locales';

/**
 * Project layout — owns the PERSISTENT chrome (TopBar + NavRail) plus the
 * project-loading gate.
 *
 * Locale note: INSIDE a project the UI language is FROZEN to `project.locale`
 * (set at creation) — an Italian project renders Italian even for a founder
 * whose account language is English, and vice-versa. This layout mounts a
 * LocaleProvider seeded from `project.locale` that shadows the account-wide
 * (root-layout, cookie-seeded) provider for all project pages. The header
 * language switch is already read-only in-project (LanguageSwitch
 * `readOnly={!!projectId}`), so the frozen locale and the switch don't fight.
 * (A prior revision dropped this provider, which regressed project pages to the
 * ACCOUNT locale — the exact "all stages in English on an IT project" bug.)
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
  const { project, loading, error, refresh } = useProject(projectId);
  const t = useT();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-ink-5 text-sm">
        Loading...
      </div>
    );
  }

  if (error || !project) {
    // Recoverable gate: with staleTime: Infinity a failed project fetch would
    // otherwise stick for the whole session — Retry refetches via
    // invalidateQueries, and "All projects" is the escape hatch.
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ flexDirection: 'column', gap: 14 }}
      >
        <span className="text-ink-5 text-sm">{error || t('project-gate.not-found')}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => refresh()}
            style={{
              padding: '6px 14px',
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {t('common.retry')}
          </button>
          <Link
            href="/"
            style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'underline' }}
          >
            {t('project-gate.all-projects')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <LocaleProvider initialLocale={asLocale(project.locale)}>
      <ChromeProvider>
        <ProjectChrome projectId={projectId} projectName={project.name}>
          {children}
        </ProjectChrome>
      </ChromeProvider>
    </LocaleProvider>
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
