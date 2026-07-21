'use client';

/**
 * Adaptive first-run guidance card pinned to the top of Home. ONE card serves
 * both lifecycle moments (it used to be two stacked peach cards):
 *
 *   - First run → the 3-step "start here" guide (Knowledge / Co-pilot / Watcher)
 *     stating the platform's job, deep-linking into the real surfaces.
 *   - Once the Idea Canvas is DEFINED but no watcher is active → the watcher
 *     nudge ("activate your first weekly watcher"), the old CanvasWatcherReminder.
 *
 * At most one variant shows. Dismissal is per-project: localStorage is the
 * instant/optimistic path, and it's ALSO persisted into projects.settings
 * (onboarding_dismissed) so the founder doesn't get re-onboarded on every new
 * device/browser. Either signal hides the card.
 *
 * Visibility is read via useSyncExternalStore (the same pattern useChat uses) so
 * it's SSR-safe and lint-clean: the server snapshot is "dismissed" (renders
 * nothing → no hydration flash/mismatch), and the client snapshot reads the real
 * localStorage value after hydration. No setState-in-effect.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

const dismissedKey = (projectId: string) => `lp_onboarding_dismissed_${projectId}`;
const DISMISS_EVENT = 'lp-onboarding-dismissed';

interface CanvasShape { solution?: string | null; value_proposition?: string | null }
interface MonitorShape { status?: string }

function subscribe(cb: () => void): () => void {
  window.addEventListener('storage', cb);
  window.addEventListener(DISMISS_EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(DISMISS_EVENT, cb);
  };
}

export function OnboardingCard({ projectId }: { projectId: string }) {
  const t = useT();
  const key = dismissedKey(projectId);

  const dismissed = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(key) === '1';
      } catch {
        return false;
      }
    },
    () => true, // SSR + first hydration: treat as dismissed so nothing flashes.
  );

  // Server-side dismissal flag (cross-device). Read via the project row —
  // mapProject spreads the settings JSONB into the response.
  const { data: serverDismissed } = useQuery<boolean>({
    queryKey: ['project-onboarding-dismissed', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      const body = await res.json();
      const settings = (body?.data ?? body)?.settings;
      return settings != null && typeof settings === 'object'
        && (settings as { onboarding_dismissed?: unknown }).onboarding_dismissed === true;
    },
  });

  // Drives the watcher-nudge variant: show it once the canvas is defined
  // (solution + value_proposition) AND no watcher is active yet.
  const { data: canvas } = useQuery<CanvasShape>({
    queryKey: ['idea-canvas', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/idea-canvas`);
      const body = await res.json();
      return (body?.data ?? body ?? {}) as CanvasShape;
    },
  });

  const { data: monitors } = useQuery<MonitorShape[]>({
    queryKey: ['monitors', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/monitors`);
      const body = await res.json();
      const list = body?.data ?? body ?? [];
      return (Array.isArray(list) ? list : (list.monitors ?? [])) as MonitorShape[];
    },
  });

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* private mode — re-renders won't persist, but the dispatch still hides it */
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
    // Cross-device persistence — fire-and-forget; localStorage already hid the
    // card, so a failed write just means this device-only fallback behavior.
    fetch(`/api/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { onboarding_dismissed: true } }),
    }).catch(() => {});
  }, [key, projectId]);

  if (dismissed || serverDismissed) return null;

  const canvasReady = !!(canvas?.solution && canvas?.value_proposition);
  const activeWatchers = Array.isArray(monitors) ? monitors.filter((m) => m?.status === 'active').length : 0;
  const watcherNudge = canvasReady && activeWatchers === 0;

  const title = watcherNudge ? t('reminder.canvas-watcher.title') : t('onboarding.title');
  const headerIcon = watcherNudge ? I.bell : I.check;

  const steps = [
    { icon: I.book, label: t('onboarding.step-knowledge'), href: `/project/${projectId}/knowledge` },
    { icon: I.chat, label: t('onboarding.step-canvas'), href: `/project/${projectId}/chat` },
    { icon: I.signal, label: t('onboarding.step-watcher'), href: `/project/${projectId}/actions?lane=monitor` },
  ];

  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--r-l)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Icon d={headerIcon} size={13} stroke={1.5} style={{ color: 'var(--accent)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--ink-2)',
          }}
        >
          {title}
        </h2>
        <div style={{ flex: 1 }} />
        <button
          onClick={dismiss}
          style={{
            fontSize: 11,
            fontFamily: 'var(--f-mono)',
            color: 'var(--ink-4)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: '2px 4px',
          }}
        >
          {t('onboarding.dismiss')}
        </button>
      </header>

      {watcherNudge ? (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {t('reminder.canvas-watcher.body')}
          </p>
          <Link
            href={`/project/${projectId}/actions?lane=monitor`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start', padding: '7px 12px', borderRadius: 6, background: 'var(--ink)', color: 'var(--paper)', fontSize: 12.5, textDecoration: 'none' }}
          >
            <Icon d={I.signal} size={13} stroke={1.5} />
            {t('reminder.canvas-watcher.cta')}
          </Link>
        </div>
      ) : (
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {t('onboarding.intro')}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {steps.map((s, i) => (
              <Link
                key={s.href}
                href={s.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'background .1s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', width: 14 }}>
                  {i + 1}
                </span>
                <Icon d={s.icon} size={14} stroke={1.4} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>{s.label}</span>
                <Icon d={I.arrow} size={11} stroke={1.4} style={{ color: 'var(--ink-5)', flexShrink: 0 }} />
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default OnboardingCard;
