/**
 * Catalog registry + the `translate` core used by the `useT` hook.
 *
 * Lookup chain for every key:  locale catalog → English → the key itself.
 * That means a half-translated language degrades gracefully to English rather
 * than rendering blanks, and a typo'd key shows the key (a visible signal in
 * dev) instead of crashing.
 *
 * UI catalogs currently exist for en + it. Other supported locales fall back to
 * English text in the chrome — but the *agent's* responses are still localized
 * for them via the prompt directive (see agent-prompt.ts). Add a language to
 * the UI by dropping in `messages/<locale>.ts` and registering it here.
 */

import type { Locale } from '@/lib/i18n/locales';
import { en, type MessageKey, type Messages } from './en';
import { it } from './it';

const CATALOGS: Record<Locale, Partial<Messages>> = {
  en,
  it,
  fr: {},
  es: {},
  de: {},
  pt: {},
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
