/**
 * Pure date helpers for grants tracking. All dates are 'YYYY-MM-DD' strings
 * compared lexically; "today" is always passed in (UTC calendar date of `now`).
 * No Date.now() here — determinism is the point.
 */

export type IsoDate = string; // 'YYYY-MM-DD'

export function isValidCalendarDate(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** UTC calendar date of a Date. */
export function toDateOnly(d: Date): IsoDate {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Leading ISO date of any ISO-ish string:
 *   '2027-04-21T00:00:00.000+0000' → '2027-04-21'
 *   '2026-09-07T00:00:00.000'      → '2026-09-07'
 *   '2026-09-07'                   → '2026-09-07'
 * Null for anything else or an impossible calendar date.
 */
export function parseIsoDeadline(value: unknown): IsoDate | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})(?:[T\s]|$)/.exec(value);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!isValidCalendarDate(y, mo, d)) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** 'DD/MM/YYYY' (Italian) → 'YYYY-MM-DD'. Tolerates surrounding whitespace. */
export function parseItalianDate(value: unknown): IsoDate | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d{2})\/(\d{2})\/(\d{4})\s*$/.exec(value);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (!isValidCalendarDate(y, mo, d)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** 'HH:MM' from 'HH:MM' / 'H:MM' / 'HH.MM'; null otherwise. */
export function parseTimeHHMM(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d{1,2})[:.](\d{2})\s*$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad2(h)}:${m[2]}`;
}

/** Strictly after today. `today` is a Date (UTC calendar date is used) or an IsoDate. */
export function isFutureDate(isoDate: IsoDate, today: Date | IsoDate): boolean {
  const t = typeof today === 'string' ? today : toDateOnly(today);
  return isoDate > t;
}

/** Today or later — what "still open" means for a deadline with an unknown hour. */
export function isTodayOrFuture(isoDate: IsoDate, today: Date | IsoDate): boolean {
  const t = typeof today === 'string' ? today : toDateOnly(today);
  return isoDate >= t;
}

export function maxIsoDate(dates: readonly (IsoDate | null | undefined)[]): IsoDate | null {
  let best: IsoDate | null = null;
  for (const d of dates) if (d && (best === null || d > best)) best = d;
  return best;
}

/**
 * Legacy LLM-scan gate: find a deadline in a headline. Accepts DD/MM/YYYY and
 * YYYY-MM-DD anywhere in the text (word-bounded). When several dates appear the
 * LATEST wins (headlines like "opens 01/10/2026, closes 15/12/2026").
 * `snippet` is the exact matched substring.
 */
export function extractDeadlineFromHeadline(headline: string): { date: IsoDate; snippet: string } | null {
  if (!headline) return null;
  const re = /(?<![\d/])(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})(?![\d/-])/g;
  let best: { date: IsoDate; snippet: string } | null = null;
  for (const m of headline.matchAll(re)) {
    const raw = m[1];
    const date = raw.includes('/') ? parseItalianDate(raw) : parseIsoDeadline(raw);
    if (!date) continue;
    if (!best || date > best.date) best = { date, snippet: raw };
  }
  return best;
}

/** 'YYYY-MM-DD' → locale display: it 'DD/MM/YYYY', en 'YYYY-MM-DD' (unambiguous). */
export function formatDeadlineForLocale(isoDate: IsoDate, locale: 'en' | 'it'): string {
  if (locale === 'it') {
    const [y, m, d] = isoDate.split('-');
    return `${d}/${m}/${y}`;
  }
  return isoDate;
}
