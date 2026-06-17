'use client';

/**
 * First-run orientation card (changelog 17/06 item 1: "guide the user through
 * the first steps with a quick tutorial — a structured onboarding comes later").
 *
 * A compact, dismissible card pinned to the top of Home that states the platform's
 * job (Watchers + Graph for monitoring/shaping the ecosystem; Co-pilot for the
 * Idea Canvas + venture building) and gives 3 concrete "start here" steps that
 * deep-link into the real surfaces. Dismissal is per-project in localStorage so it
 * doesn't nag once the founder is rolling.
 *
 * Visibility is read via useSyncExternalStore (the same pattern useChat uses) so
 * it's SSR-safe and lint-clean: the server snapshot is "dismissed" (renders
 * nothing → no hydration flash/mismatch), and the client snapshot reads the real
 * localStorage value after hydration. No setState-in-effect.
 */

import { useCallback, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { Icon, I } from '@/components/design/primitives';
import { useT } from '@/components/providers/LocaleProvider';

const dismissedKey = (projectId: string) => `lp_onboarding_dismissed_${projectId}`;
const DISMISS_EVENT = 'lp-onboarding-dismissed';

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

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* private mode — re-renders won't persist, but the dispatch still hides it */
    }
    window.dispatchEvent(new Event(DISMISS_EVENT));
  }, [key]);

  if (dismissed) return null;

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
        <Icon d={I.check} size={13} stroke={1.5} style={{ color: 'var(--accent)' }} />
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
          {t('onboarding.title')}
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
    </section>
  );
}

export default OnboardingCard;
