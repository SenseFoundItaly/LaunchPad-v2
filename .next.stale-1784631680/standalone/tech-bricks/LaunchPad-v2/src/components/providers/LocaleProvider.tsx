'use client';

/**
 * LocaleProvider — makes the active locale + a bound `t()` available to every
 * client component. Seeded once from the server layout (which reads the
 * `lp_locale` cookie), so SSR and the first client render agree — no flash of
 * the wrong language.
 *
 * Switching language is a cookie write + full reload (see LanguageSelector),
 * not a live context mutation: a reload lets the SERVER components (root
 * layout, server-rendered pages) re-render in the new language too. A
 * context-only swap would leave those stale.
 */

import * as React from 'react';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';
import { translate, type MessageKey, type TranslateVars } from '@/lib/i18n/messages';

type TFn = (key: MessageKey, vars?: TranslateVars) => string;

interface LocaleContextValue {
  locale: Locale;
  t: TFn;
}

const LocaleContext = React.createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  t: (key, vars) => translate(DEFAULT_LOCALE, key, vars),
});

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const value = React.useMemo<LocaleContextValue>(
    () => ({
      locale: initialLocale,
      t: (key, vars) => translate(initialLocale, key, vars),
    }),
    [initialLocale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Current active locale (e.g. for `dir`, date formatting, the picker value). */
export function useLocale(): Locale {
  return React.useContext(LocaleContext).locale;
}

/** The translate function bound to the active locale: `t('nav.home')`. */
export function useT(): TFn {
  return React.useContext(LocaleContext).t;
}
