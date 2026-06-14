/**
 * Locale resolution — turns "who is this / which project" into a single Locale.
 *
 * There are two stored signals:
 *   - users.locale     — the account-wide preference the language switch sets.
 *   - projects.locale   — legacy per-project locale, set ONCE at creation from
 *                         the partner/white-label config and never updated.
 *
 * The data-fetching below is boilerplate. The interesting part is `pickLocale`:
 * when the two disagree, who wins? That's a product decision (see its docs).
 */

import { query } from '@/lib/db';
import { asLocale, isLocale, DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

/** Raw candidates pulled from the DB, before precedence is applied. */
export interface LocaleCandidates {
  /** users.locale — account-wide preference. NULL when the user never chose. */
  user: string | null;
  /** projects.locale — legacy, set at project creation (often by a partner). */
  project: string | null;
}

/**
 * Decide which locale wins.
 *
 * Product rule (decided 2026-06-14): **a project stays in the language it was
 * created in.** So whenever a project context exists, its (frozen) locale wins
 * — for the agent AND the UI chrome inside that project. The account-wide
 * `users.locale` only governs project-less surfaces (settings, the projects
 * list, onboarding) and the *default* language stamped onto new projects at
 * creation time.
 *
 * Hence the order: project > user > English. Must always return a valid Locale
 * (never null).
 */
export function pickLocale(c: LocaleCandidates): Locale {
  if (isLocale(c.project)) return c.project;
  if (isLocale(c.user)) return c.user;
  return DEFAULT_LOCALE;
}

/**
 * Fetch the locale candidates from the DB and apply precedence.
 * Either id may be null (e.g. the project-less /settings page passes only the
 * user; an unauthenticated context passes neither → DEFAULT_LOCALE).
 */
export async function resolveLocale(
  userId: string | null,
  projectId: string | null,
): Promise<Locale> {
  const candidates: LocaleCandidates = { user: null, project: null };

  if (userId) {
    const rows = await query<{ locale: string | null }>(
      'SELECT locale FROM users WHERE id = ?',
      userId,
    );
    candidates.user = rows[0]?.locale ?? null;
  }

  if (projectId) {
    const rows = await query<{ locale: string | null }>(
      'SELECT locale FROM projects WHERE id = ?',
      projectId,
    );
    candidates.project = rows[0]?.locale ?? null;
  }

  return pickLocale(candidates);
}

/** Convenience for callers that already hold a raw cookie/string value. */
export { asLocale };
