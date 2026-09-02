/**
 * Grants page — pure view logic shared by the API route (response types) and
 * the page components (filters, buckets, freshness). No React, no DB.
 */
import type { FundingSource, FundingCallStatus, PageStatus, FundingFacets } from './types';

/** Why a call ranked where it did — rendered as chips, never prose. */
export type MatchKind = 'region' | 'national' | 'scope' | 'subject' | 'term' | 'closing';

export interface MatchReason {
  kind: MatchKind;
  label: string;
}

export interface RelevanceResult {
  /** Higher is more relevant. Integer, so ordering is exact. */
  score: number;
  reasons: MatchReason[];
}

export interface FundingCallView {
  id: string;
  source: FundingSource;
  title: string;
  granting_body: string | null;
  official_url: string;
  /** 'YYYY-MM-DD' (deadline::text); null for rolling. */
  deadline: string | null;
  /** 'HH:MM' or null. */
  deadline_time: string | null;
  status: FundingCallStatus;
  /** Full text, never truncated server-side. */
  eligibility_text: string | null;
  /** ISO timestamp. */
  last_verified_at: string;
  /** EXISTS ecosystem_alerts(project_id, funding_call_id). */
  alerted: boolean;
  /** Whether the official page was read (db/migrations/045). */
  page_status: PageStatus;
  page_error: string | null;
  page_checked_at: string | null;
  regions: string[] | null;
  facets: FundingFacets | null;
  source_note: string | null;
  catalog_url: string | null;
  /**
   * Attached by the API when the project has enough text to rank against
   * (see relevance.ts). Absent ⇒ the page falls back to deadline order.
   */
  relevance?: RelevanceResult;
}

export interface SourceFreshness {
  source: FundingSource;
  /** ISO or null. */
  last_success_at: string | null;
  last_count: number | null;
  last_error: string | null;
  /** Last scan ATTEMPT (success or failure) — funding_source_state.updated_at. */
  updated_at: string | null;
  /** Open calls whose official page has not been read yet / could not be read. */
  pages_unread: number | null;
  pages_failed: number | null;
}

/** How the founder is currently ordering the list. */
export type GrantsSort = 'relevance' | 'deadline';

/** What the project's own words yielded — shown so ranking is never a black box. */
export interface ProjectSignalSummary {
  regions: string[];
  scopes: string[];
  subjectTypes: string[];
  /** False ⇒ too little project text to rank; the page hides the relevance sort. */
  usable: boolean;
}

export interface GrantsResponse {
  /** ≤ 2500. Ordered by relevance when signals are usable, else deadline ASC. */
  calls: FundingCallView[];
  /** Always exactly 2 rows, order ['sedia', 'lombardia']. */
  sources: SourceFreshness[];
  /** This project's non-archived type='ecosystem.grants' monitor. */
  grants_monitor: { id: string; status: string } | null;
  /** Null when the project has too little text to derive signals from. */
  project_signals: ProjectSignalSummary | null;
  generated_at: string;
}

/** Identical to HeartbeatKind in primitives. */
export type FreshnessKind = 'healthy' | 'stale' | 'dead';
export type DeadlineBucket = 'closing-soon' | 'open' | 'rolling';
export type GrantsChip = 'all' | 'closing-soon' | 'rolling' | 'sedia' | 'lombardia' | 'incentivi';
export const GRANTS_CHIPS: readonly GrantsChip[] = ['all', 'closing-soon', 'rolling', 'sedia', 'lombardia', 'incentivi'];

/** Region names exactly as incentivi.gov.it tags them. */
export const ITALIAN_REGIONS: readonly string[] = [
  'Abruzzo', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio',
  'Liguria', 'Lombardia', 'Marche', 'Molise', 'Piemonte', 'Puglia', 'Sardegna', 'Sicilia', 'Toscana',
  "Trentino-Alto Adige/Südtirol", 'Umbria', "Valle d'Aosta/Vallée d'Aoste", 'Veneto',
];
/** Pseudo-region for the filter: national measures only. */
export const NATIONAL_REGION = 'Nazionale';

/**
 * Region filter. null ⇒ everything. 'Nazionale' ⇒ national measures only.
 * A region ⇒ calls tagged with it PLUS national measures (they apply there
 * too) PLUS the direct Lombardia feed when the region is Lombardia; EU calls
 * (no regions, not national) are excluded by a regional filter.
 */
export function matchesRegion(call: FundingCallView, region: string | null): boolean {
  if (!region) return true;
  const national = call.facets?.national === true;
  if (region === NATIONAL_REGION) return national;
  if (national) return true;
  if (call.source === 'lombardia') return region === 'Lombardia';
  return (call.regions ?? []).includes(region);
}

export const CLOSING_SOON_DAYS = 30;
export const URGENT_DAYS = 7;
export const FRESH_HEALTHY_MS = 36 * 60 * 60 * 1000;
export const FRESH_STALE_MS = 72 * 60 * 60 * 1000;
export const ELIGIBILITY_EXCERPT_CHARS = 280;

const DAY_MS = 86_400_000;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * dead when last_error is a real failure (anything not starting with 'truncated:'),
 * when last_success_at is null/unparseable, or age >= 72h; stale when
 * 36h <= age < 72h OR when a 'truncated:' warning is set (never better than
 * stale); healthy otherwise. Negative age → healthy.
 */
export function classifyFreshness(
  lastSuccessAt: string | null,
  lastError: string | null,
  now: Date,
): FreshnessKind {
  const truncated = !!lastError && lastError.startsWith('truncated:');
  if (lastError && !truncated) return 'dead';
  const successMs = parseMs(lastSuccessAt);
  if (successMs === null) return 'dead';
  const age = now.getTime() - successMs;
  if (age >= FRESH_STALE_MS) return 'dead';
  if (truncated) return 'stale';
  if (age >= FRESH_HEALTHY_MS) return 'stale';
  return 'healthy';
}

/**
 * Calendar-day difference: UTC date of `deadline` ('YYYY-MM-DD') minus the LOCAL
 * calendar date of `now`. null when deadline is null or malformed.
 */
export function countdownParts(deadline: string | null, now: Date): { days: number } | null {
  if (!deadline) return null;
  const m = ISO_DATE_RE.exec(deadline);
  if (!m) return null;
  const target = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return { days: Math.round((target - today) / DAY_MS) };
}

/**
 * 'rolling' when status === 'rolling' OR deadline is null; 'closing-soon' when
 * days <= 30 (negative days too); else 'open'.
 */
export function deadlineBucket(
  call: Pick<FundingCallView, 'status' | 'deadline'>,
  now: Date,
): DeadlineBucket {
  if (call.status === 'rolling' || call.deadline === null) return 'rolling';
  const parts = countdownParts(call.deadline, now);
  if (parts === null) return 'rolling';
  return parts.days <= CLOSING_SOON_DAYS ? 'closing-soon' : 'open';
}

/**
 * Pill kind for the status pill: 'closed' → 'n'; rolling → 'info'; deadline
 * already passed (days < 0 — expireFundingCalls runs once a day in UTC, so a
 * call can be past its deadline and still 'open') → 'n'; days <= 7 → 'warn';
 * else 'ok'.
 */
export function statusPillKind(
  call: Pick<FundingCallView, 'status' | 'deadline'>,
  now: Date,
): 'ok' | 'warn' | 'info' | 'n' {
  if (call.status === 'closed') return 'n';
  if (deadlineBucket(call, now) === 'rolling') return 'info';
  const parts = countdownParts(call.deadline, now);
  if (parts !== null && parts.days < 0) return 'n';
  if (parts !== null && parts.days <= URGENT_DAYS) return 'warn';
  return 'ok';
}

/** Case-insensitive, trimmed substring match on title OR granting_body. '' → true. */
export function matchesQuery(
  call: Pick<FundingCallView, 'title' | 'granting_body'>,
  q: string,
): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (call.title.toLowerCase().includes(needle)) return true;
  return !!call.granting_body && call.granting_body.toLowerCase().includes(needle);
}

function matchesChip(call: FundingCallView, chip: GrantsChip, now: Date): boolean {
  switch (chip) {
    case 'all':
      return true;
    case 'closing-soon':
      return deadlineBucket(call, now) === 'closing-soon';
    case 'rolling':
      return deadlineBucket(call, now) === 'rolling';
    case 'sedia':
    case 'lombardia':
    case 'incentivi':
      return call.source === chip;
  }
}

/** Search first, then chip. Returns a NEW sorted array. */
export function applyFilters(
  calls: FundingCallView[],
  opts: { chip: GrantsChip; q: string; region?: string | null; sort?: GrantsSort },
  now: Date,
): FundingCallView[] {
  const kept = calls.filter(
    (c) => matchesQuery(c, opts.q) && matchesRegion(c, opts.region ?? null) && matchesChip(c, opts.chip, now),
  );
  return opts.sort === 'relevance' ? sortByRelevance(kept) : sortCalls(kept);
}

/**
 * Relevance DESC, then the deadline order as the tie-break, so two calls the
 * scorer cannot separate still come out in a stable, meaningful sequence. A
 * call with no relevance attached sorts as 0 rather than disappearing.
 */
export function sortByRelevance(calls: FundingCallView[]): FundingCallView[] {
  return [...calls].sort((a, b) => {
    const sa = a.relevance?.score ?? 0;
    const sb = b.relevance?.score ?? 0;
    if (sa !== sb) return sb - sa;
    if (a.deadline === null && b.deadline !== null) return 1;
    if (a.deadline !== null && b.deadline === null) return -1;
    if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline) {
      return a.deadline < b.deadline ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

/** Counts per chip over `calls` (caller passes the search-filtered set). */
export function chipCounts(calls: FundingCallView[], now: Date): Record<GrantsChip, number> {
  const counts: Record<GrantsChip, number> = {
    all: 0,
    'closing-soon': 0,
    rolling: 0,
    sedia: 0,
    lombardia: 0,
    incentivi: 0,
  };
  for (const c of calls) {
    for (const chip of GRANTS_CHIPS) {
      if (matchesChip(c, chip, now)) counts[chip] += 1;
    }
  }
  return counts;
}

/** Stable copy sorted deadline ASC with null deadlines LAST, ties by title. */
export function sortCalls(calls: FundingCallView[]): FundingCallView[] {
  return [...calls].sort((a, b) => {
    if (a.deadline === null && b.deadline !== null) return 1;
    if (a.deadline !== null && b.deadline === null) return -1;
    if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline) {
      return a.deadline < b.deadline ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  });
}

/**
 * Whitespace-collapsed excerpt. Cut at the last space at or before `max` (but
 * not before max*0.6), append '…'.
 */
export function excerptEligibility(
  text: string | null,
  max: number = ELIGIBILITY_EXCERPT_CHARS,
): { short: string; truncated: boolean } {
  if (!text) return { short: '', truncated: false };
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return { short: '', truncated: false };
  if (collapsed.length <= max) return { short: collapsed, truncated: false };
  const lastSpace = collapsed.lastIndexOf(' ', max);
  const cut = lastSpace >= Math.floor(max * 0.6) ? lastSpace : max;
  return { short: collapsed.slice(0, cut).trimEnd() + '…', truncated: true };
}

/**
 * Relative age in whole units: < 60s → now; < 60m → minutes; < 48h → hours;
 * < 14d → days; else weeks. null when iso is null/unparseable.
 */
export function relativeAge(
  iso: string | null,
  now: Date,
): { unit: 'now' | 'minutes' | 'hours' | 'days' | 'weeks'; n: number } | null {
  const ms = parseMs(iso);
  if (ms === null) return null;
  const age = Math.max(0, now.getTime() - ms);
  const sec = Math.floor(age / 1000);
  if (sec < 60) return { unit: 'now', n: 0 };
  const min = Math.floor(sec / 60);
  if (min < 60) return { unit: 'minutes', n: min };
  const hours = Math.floor(min / 60);
  if (hours < 48) return { unit: 'hours', n: hours };
  const days = Math.floor(hours / 24);
  if (days < 14) return { unit: 'days', n: days };
  return { unit: 'weeks', n: Math.floor(days / 7) };
}
