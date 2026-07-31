/**
 * Catalog registry + the `translate` core used by the `useT` hook.
 *
 * Lookup chain for every key:  locale catalog → English → the key itself.
 * That means a half-translated language degrades gracefully to English rather
 * than rendering blanks, and a typo'd key shows the key (a visible signal in
 * dev) instead of crashing.
 *
 * UI catalogs exist for en + it — the only locales in SUPPORTED_LOCALES (the
 * picker is restricted to fully-translated languages). Add a language by
 * dropping in `messages/<locale>.ts`, registering it here, AND adding it to
 * SUPPORTED_LOCALES. The English fallback below still protects any partial key.
 *
 * SURFACE NAMES — these are translated, but deliberately and not literally.
 * The 17/06 feedback was never "don't translate", it was "don't translate into
 * a word that means something else": it "Posta" read as email and buried the
 * watchers, "Sapere" read as abstract knowingness. The 2026-07-21 founder
 * decision (alpha feedback) replaced the old blanket freeze with chosen IT
 * names — **Knowledge → Conoscenza** (nav.knowledge) and **Intel → Osservatori**
 * (nav.inbox, "the observers", which is what the watchers actually are).
 * Renaming either again is a product decision, not a translation fix.
 * Co-pilot and Canvas remain untranslated — they read the same in both.
 */

import type { Locale } from '@/lib/i18n/locales';
import { en, type MessageKey, type Messages } from './en';
import { it } from './it';

const CATALOGS: Record<Locale, Partial<Messages>> = {
  en,
  it,
};

export type TranslateVars = Record<string, string | number>;

/**
 * Resolve a key for a locale, applying English fallback and `{placeholder}`
 * interpolation. Unprovided placeholders are left intact so they're visible.
 */
export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const template = CATALOGS[locale]?.[key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export type { MessageKey };
