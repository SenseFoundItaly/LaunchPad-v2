'use client';

/**
 * Compact language switcher for the TopBar (EN / IT). Mirrors the settings-page
 * LanguageSelector logic — PATCH /api/user/preferences (which sets users.locale
 * + the lp_locale cookie) then a full reload so server-rendered surfaces pick up
 * the new language. Surfaced in the header so it's reachable from anywhere, not
 * buried in settings (founder feedback 2026-06-17).
 */

import { useState, useRef, useEffect } from 'react';
import api from '@/api';
import { SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locales';
import { useLocale } from '@/components/providers/LocaleProvider';

export function LanguageSwitch() {
  const current = useLocale();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function choose(loc: Locale) {
    if (loc === current || saving) { setOpen(false); return; }
    setSaving(true);
    try {
      await api.patch('/api/user/preferences', { locale: loc });
      window.location.reload();
    } catch {
      setSaving(false);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Language"
        title="Language"
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 8px', borderRadius: 6,
          border: '1px solid var(--line-2)', background: 'var(--surface)',
          color: 'var(--ink-3)', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '.04em',
        }}
      >
        {current}
        <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0,
            background: 'var(--surface)', border: '1px solid var(--line)',
            borderRadius: 8, boxShadow: 'var(--shadow-card)', padding: 4,
            zIndex: 1000, minWidth: 64,
          }}
        >
          {SUPPORTED_LOCALES.map((loc) => (
            <button
              key={loc}
              type="button"
              onClick={() => choose(loc)}
              disabled={saving}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '5px 9px', borderRadius: 4, border: 'none',
                background: loc === current ? 'var(--paper-2)' : 'transparent',
                color: 'var(--ink-2)', fontSize: 12,
                fontWeight: loc === current ? 600 : 400, cursor: 'pointer',
                textTransform: 'uppercase', letterSpacing: '.04em',
              }}
            >
              {loc}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
