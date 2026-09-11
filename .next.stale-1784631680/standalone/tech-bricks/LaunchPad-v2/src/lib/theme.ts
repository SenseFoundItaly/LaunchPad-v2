/**
 * Theme cookie — read server-side in the root layout so SSR renders the same
 * theme classes the client has (no hydration mismatch, no FOUC). Written
 * client-side by the NavRail ThemeToggle.
 *
 * Values: 'light' | 'dark'. Absent = dark (the app's established default).
 */
export const THEME_COOKIE = 'lp-theme';

export type Theme = 'light' | 'dark';
