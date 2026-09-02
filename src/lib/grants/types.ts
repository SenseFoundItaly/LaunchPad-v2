/**
 * Grants tracking — shared contracts between the source connectors
 * (src/lib/grants/sources/*), the sync (src/lib/grants/sync.ts) and the cron.
 *
 * Connectors produce NormalizedCall[] from TYPED source fields (dates parsed
 * in code, never by a model). The sync owns every DB write.
 */

export type FundingSource = 'sedia' | 'lombardia';
export const FUNDING_SOURCES: readonly FundingSource[] = ['sedia', 'lombardia'] as const;

export type FundingCallStatus = 'open' | 'rolling' | 'closed';
export type ParseMethod = 'iso_field' | 'socrata_field' | 'regex';

/** Connector output. Connectors never emit 'closed' — closure is the sync's job. */
/** Whether the call's official page was read: see db/migrations/045. */
export type PageStatus = 'unread' | 'ok' | 'failed' | 'n/a';

export interface NormalizedCall {
  source: FundingSource;
  /** Stable per-source id (SEDIA topic identifier, Lombardia codice_bando). */
  source_identifier: string;
  official_url: string;
  title: string;
  granting_body: string | null;
  /** 'YYYY-MM-DD' (UTC calendar date) or null when status === 'rolling'. */
  deadline: string | null;
  /** 'HH:MM' local time or null. */
  deadline_time: string | null;
  status: 'open' | 'rolling';
  eligibility_text: string | null;
  /** Exact source substring the deadline was parsed from ('' only for rolling). */
  raw_snippet: string;
  parse_method: ParseMethod;
  /** Omitted ⇒ 'unread' (Lombardia before its detail fetch). SEDIA sets 'n/a'. */
  page_status?: PageStatus;
  page_error?: string | null;
}

/** Row shape of funding_calls (db/migrations/044_funding_calls.sql). */
export interface FundingCall {
  id: string;
  source: FundingSource;
  source_identifier: string;
  official_url: string;
  title: string;
  granting_body: string | null;
  deadline: string | null;
  deadline_time: string | null;
  status: FundingCallStatus;
  eligibility_text: string | null;
  raw_snippet: string | null;
  parse_method: ParseMethod | null;
  missed_syncs: number;
  first_seen_at: string;
  last_verified_at: string;
  closed_at: string | null;
  updated_at: string;
  page_status: PageStatus;
  page_error: string | null;
  page_checked_at: string | null;
}

/** Row shape of funding_source_state. */
export interface FundingSourceState {
  source: FundingSource;
  last_success_at: string | null;
  last_error: string | null;
  last_count: number | null;
  updated_at: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ConnectorOptions {
  /** Injected for tests; defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** "Today" for every future/past decision — never read Date.now() inside a connector. */
  now: Date;
  /**
   * Given every identifier the connector is about to return, answer which ones
   * warrant a bounded detail fetch (new / never-enriched). Provided by the sync;
   * connectors without a detail step ignore it. Default: all identifiers.
   */
  needsDetail?: (identifiers: string[]) => Promise<Set<string>>;
}

export interface SediaOptions extends ConnectorOptions {
  /** Hard cap on search pages (100 rows each). Default 8. */
  maxPages?: number;
  /** Default 100 (the API max used in verification). */
  pageSize?: number;
}

export interface LombardiaOptions extends ConnectorOptions {
  /** Fetch detail pages for needsDetail identifiers. Default true. */
  resolveDetails?: boolean;
  /** Resolve official_url from the portal sitemap (canonical category/slug path),
   *  bare-codice URL as fallback. Default true. Measured 2026-09-02: bare 404s for
   *  4/171 calls; canonical resolves all of them. */
  resolveCanonicalUrls?: boolean;
  /** Max detail pages per run. Default 10. */
  maxDetailFetches?: number;
  /** Wall-clock budget for the detail loop, ms. Default 30_000. */
  detailBudgetMs?: number;
}

/**
 * What a connector hands the sync. `complete: false` means the listing was cut
 * short (SEDIA page cap, Socrata row limit): the calls that WERE fetched are
 * still upserted, but absence from a partial listing is no evidence of
 * closure, so the sync must skip its mark-missing step for that run.
 */
export interface ConnectorResult {
  calls: NormalizedCall[];
  complete: boolean;
}

export interface SourceConnector {
  source: FundingSource;
  fetchCalls(opts: ConnectorOptions): Promise<ConnectorResult>;
}

export interface SourceSyncResult {
  source: FundingSource;
  /** false when the fetch threw or returned zero rows. */
  ok: boolean;
  error: string | null;
  /** true when the once-per-day gate skipped this source (no fetch happened). */
  skipped_gate: boolean;
  /** true when the connector reported a truncated listing: upserts ran, mark-missing was SKIPPED. */
  partial: boolean;
  fetched: number;
  inserted: number;
  updated: number;
  /** previously-closed calls seen open again (proroga after expiry / return after misses) — their auto-dismissed alerts are re-opened. */
  reopened: number;
  closed_missing: number;
  alerts_created: number;
  /** pending alerts whose headline/body were rewritten because the call's deadline or status changed. */
  alerts_refreshed: number;
}

export interface SyncResult {
  sources: SourceSyncResult[];
  /** open rows flipped to closed because deadline < CURRENT_DATE. */
  expired: number;
  /** pending ecosystem_alerts (and their signal_alert tickets) auto-dismissed because their call is closed. */
  alerts_dismissed: number;
  /** Set when a phase outside the per-source loop (watcher lookup, expiry) failed; per-source results are kept. */
  error?: string | null;
}

export interface SyncOptions {
  /** Default: [sediaConnector, lombardiaConnector]. */
  sources?: SourceConnector[];
  now?: Date;
  /** Bypass the once-per-day gate (dry-run / manual). Default false. */
  force?: boolean;
  fetch?: FetchLike;
}
