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
 * FROZEN BRAND TERMS — keep these IDENTICAL in every locale catalog (do NOT
 * translate them): **Intel** (the watcher/signal/proposal queue, nav.inbox) and
 * **Knowledge** (the graph/facts surface, nav.knowledge). Translating them
 * (e.g. it: "Posta"/"Sapere") was the source of the 17/06 naming feedback —
 * "Posta" read as email and buried the watchers. Co-pilot/Canvas are similar.
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
