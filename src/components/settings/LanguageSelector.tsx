'use client';

/**
 * Account-wide language picker. Writes users.locale via the shared preferences
 * endpoint (which also sets the lp_locale cookie), then does a full reload so
 * server-rendered surfaces (root layout, server pages) re-render in the new
 * language — a context-only swap would leave those stale.
 *
 * The current selection comes from the LocaleProvider (cookie-seeded), so this
 * stays correct without its own fetch.
 */

import { useState } from 'react';
import api from '@/api';
import { SUPPORTED_LOCALES, LOCALE_NATIVE_NAME, type Locale } from '@/lib/i18n/locales';
import { useLocale, useT } from '@/components/providers/LocaleProvider';

export function LanguageSelector() {
  const t = useT();
  const current = useLocale();
  const [saving, setSaving] = useState<Locale | null>(null);
  const [error, setError] = useState(false);

  async function choose(locale: Locale) {
    if (locale === current || saving) return;
    setSaving(locale);
    setError(false);
    try {
      await api.patch('/api/user/preferences', { locale });
      window.location.reload();
    } catch {
      setError(true);
      setSaving(null);
    }
  }

  return (
    <section className="mb-10">
      <h2 className="text-sm font-medium text-ink mb-1">{t('settings.language.title')}</h2>
      <p className="text-xs text-ink-5 mb-4">{t('settings.language.desc')}</p>

      <div className="bg-paper border border-line rounded-xl p-4">
        <div className="space-y-1.5">
          {SUPPORTED_LOCALES.map((loc) => (
            <label
              key={loc}
              className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-paper-2/50 transition-colors cursor-pointer"
            >
              <input
                type="radio"
                name="locale"
                checked={current === loc}
                onChange={() => choose(loc)}
                disabled={saving !== null}
                className="accent-moss"
              />
              <span className="text-sm text-ink-2">{LOCALE_NATIVE_NAME[loc]}</span>
              <span className="text-[10px] uppercase text-ink-5 font-mono">{loc}</span>
            </label>
          ))}
        </div>
        {saving && <p className="text-xs text-ink-5 mt-2">{t('settings.language.saving')}</p>}
        {error && <p className="text-xs text-clay mt-2">{t('settings.language.error')}</p>}
      </div>
    </section>
  );
}
