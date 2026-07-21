'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/components/providers/LocaleProvider';
import { THEME_COOKIE } from '@/lib/theme';
import { RailTooltip, useRailHover } from '@/components/design/icons';

/**
 * Light/dark theme toggle for the NavRail.
 *
 * The whole design system is token-driven: `:root` holds the LIGHT palette and
 * `.theme-ink` overrides it to DARK, and Tailwind's `@theme inline` maps every
 * color utility to those vars — so switching themes is just adding/removing the
 * `theme-ink` (+ Tailwind `dark`) classes on <html>. The choice persists in a
 * cookie the root layout reads server-side, so SSR renders the same classes
 * (no hydration mismatch, no FOUC). Default is dark (the app's established look).
 */
export function ThemeToggle() {
  const t = useT();
  const [dark, setDark] = useState(true);
  const { hover, bind } = useRailHover();

  // Sync from the DOM after mount (SSR already applied the cookie-driven class).
  useEffect(() => {
    setDark(document.documentElement.classList.contains('theme-ink'));
  }, []);

  function toggle() {
    const el = document.documentElement;
    const goingLight = el.classList.contains('theme-ink');
    const next = goingLight ? 'light' : 'dark';
    if (goingLight) el.classList.remove('theme-ink', 'dark');
    else el.classList.add('theme-ink', 'dark');
    // Persist for next SSR. 1-year cookie, lax, root path.
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setDark(!goingLight);
  }

  const label = dark ? t('theme.to-light') : t('theme.to-dark');

  return (
    <button
      onClick={toggle}
      aria-label={label}
      {...bind}
      style={{
        flexShrink: 0,
        width: 42,
        height: 38,
        borderRadius: 'var(--r-m)',
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        color: hover ? 'var(--ink-2)' : 'var(--ink-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .12s, color .12s',
        position: 'relative',
      }}
    >
      {dark ? (
        // Sun — click to go light.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // Moon — click to go dark.
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
      <RailTooltip label={label} show={hover} />
    </button>
  );
}
