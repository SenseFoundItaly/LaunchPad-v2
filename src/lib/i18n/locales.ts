/**
 * Locale registry — the single source of truth for which languages the app
 * supports, how they're named, and how to validate an untrusted string.
 *
 * Everything else (the agent prompt loader, the UI message catalogs, the
 * settings selector, the resolution logic) imports `Locale` and the helpers
 * from here, so adding a language is a one-line change in SUPPORTED_LOCALES
 * plus a message catalog.
 *
 * Note the split between the two name maps:
 *   - `nativeName` is shown to the user in the language picker ("Italiano").
 *   - `englishName` is injected into the agent's system prompt ("Italian") so
 *     the directive "respond in Italian" is unambiguous to the model.
 */

export const SUPPORTED_LOCALES = ['en', 'it', 'fr', 'es', 'de', 'pt'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Native endonym — what the language calls itself. Shown in the picker. */
export const LOCALE_NATIVE_NAME: Record<Locale, string> = {
  en: 'English',
  it: 'Italiano',
  fr: 'Français',
  es: 'Español',
  de: 'Deutsch',
  pt: 'Português',
};

/** English exonym — injected into the agent prompt's "respond in X" directive. */
export const LOCALE_ENGLISH_NAME: Record<Locale, string> = {
  en: 'English',
  it: 'Italian',
  fr: 'French',
  es: 'Spanish',
  de: 'German',
  pt: 'Portuguese',
};

/** Narrow an untrusted string (cookie, request body, DB cell) to a Locale. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Coerce any value to a valid Locale, defaulting to 'en' when unrecognized. */
export function asLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Cookie name carrying the active locale for synchronous server-side reads. */
export const LOCALE_COOKIE = 'lp_locale';
