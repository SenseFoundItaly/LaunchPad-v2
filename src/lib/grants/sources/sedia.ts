/**
 * SEDIA connector — EU Funding & Tenders portal search API.
 *
 * Produces NormalizedCall[] from the TYPED `deadlineDate` field of each topic
 * (parsed in code by parseIsoDeadline — never inferred from prose, never by a
 * model). Every failure is loud: HTTP non-2xx and malformed bodies THROW, so
 * the sync records an error and leaves the DB untouched rather than closing
 * calls on an empty result.
 *
 * Verified against the live API on 2026-09-01:
 *   - POST search?apiKey=SEDIA&text=***&pageSize=N&pageNumber=N, multipart
 *     with `query` + `languages` parts; each part MUST carry
 *     `Content-Type: application/json` (curl `;type=application/json`) or the
 *     API answers HTTP 500. buildSediaMultipart() writes the parts by hand
 *     because undici's FormData/Blob adds `filename="blob"` to Blob parts,
 *     which is unverified against this API.
 *   - NO `displayFields` part. Live-verified 2026-09-01 (WP-E dry run): as
 *     soon as ANY displayFields part is sent — even one that lists it — the
 *     API silently drops `topicConditions` (the eligibility HTML) from every
 *     row, so 0/364 calls had eligibility_text. Without the part the full
 *     metadata comes back (99/100 rows carry topicConditions). The price is
 *     ~1.9 MB per 100-row page instead of ~170 KB; bounded by maxPages (8),
 *     once per day, so accepted.
 *   - status 31094501 = Forthcoming, 31094502 = Open, 31094503 = Closed. The
 *     filter requests 31094502 only, BUT a live check showed status 31094502
 *     returning both future-dated and long-closed (2023) rows on the same
 *     page (stale DATASOURCE=SEDIA_PRD_CENTRICITY duplicates included). The
 *     status code therefore does NOT decide whether a call is emitted: the
 *     client-side "max deadlineDate is today or later" check is the only
 *     thing that does (today counts as open — the Brussels-time cut-off is
 *     usually 17:00, and the sync's daily expiry closes the row the day
 *     after; Lombardia applies the same rule). The status check below is a
 *     NEGATIVE filter (a row the source itself says is not Open is never
 *     emitted), never a positive signal.
 *   - A listing cut short by maxPages is reported as `complete: false`
 *     (fetchSediaListing): the sync upserts what was fetched but must not
 *     treat absence from a partial listing as closure.
 *
 * Imports only from ../types, ../dates, ../text (relative) — no '@/lib/db' —
 * so scripts/grants-sync-dryrun.mjs can run it without any DB.
 */

import type { ConnectorResult, NormalizedCall, SediaOptions, SourceConnector } from '../types';
import { isTodayOrFuture, maxIsoDate, parseIsoDeadline, toDateOnly } from '../dates';
import { excerpt, stripHtml } from '../text';

export const SEDIA_SEARCH_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
export const SEDIA_TOPIC_URL_PREFIX =
  'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
/** verified: 31094501 = Forthcoming, 31094502 = Open, 31094503 = Closed */
export const SEDIA_STATUS_OPEN = '31094502';

/**
 * frameworkProgramme id → display label. The id→abbreviation pairs are
 * verified; descriptions other than 43108390/44181033 are reconstructed from
 * the abbreviations (cosmetic — used as granting_body only).
 */
export const SEDIA_PROGRAMME_LABELS: Record<string, string> = {
  '43108390': 'Horizon Europe (HORIZON)',
  '44181033': 'European Defence Fund (EDF)',
  '43298916': 'Euratom Research and Training Programme (EURATOM2027)',
  '45532249': 'EU Bodies and Agencies (EUBA)',
  '43152860': 'Digital Europe Programme (DIGITAL)',
  '43252405': 'Programme for Environment and Climate Action (LIFE)',
  '43251567': 'Connecting Europe Facility (CEF)',
  '43353764': 'Erasmus+ (ERASMUS)',
  '43251589': 'Citizens, Equality, Rights and Values Programme (CERV)',
  '43332642': 'EU4Health Programme (EU4H)',
  '43252449': 'Research Fund for Coal & Steel (RFCS)',
  '43251814': 'Creative Europe Programme (CREA)',
  '43637601': 'Pilot Projects and Preparatory Actions (PPPA)',
  '43252476': 'Single Market Programme (SMP)',
  '43298664': 'Promotion of Agricultural Products (AGRIP)',
  '31045243': 'Horizon 2020 (H2020)',
};

/** One search-api hit. Only `metadata` is read; every metadata value is string[]. */
export interface SediaResult {
  metadata?: Record<string, string[] | undefined>;
}

interface SediaEnvelope {
  totalResults?: unknown;
  results?: unknown;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 8;
const REQUEST_TIMEOUT_MS = 20_000;

export function buildSediaQuery(now: Date): Record<string, unknown> {
  return {
    bool: {
      must: [
        { terms: { type: ['1'] } },
        { terms: { status: [SEDIA_STATUS_OPEN] } },
        { range: { deadlineDate: { gte: `${toDateOnly(now)}T00:00:00.000+0000` } } },
      ],
    },
  };
}

/**
 * Hand-built multipart body. Each part carries `Content-Type: application/json`
 * (the curl `;type=application/json` that the API requires — without it the
 * server returns HTTP 500).
 *
 * Deliberately NO `displayFields` part: sending one makes the API omit
 * `topicConditions` from every row (see the header), and that field is the
 * only source of eligibility_text for EU calls.
 */
export function buildSediaMultipart(now: Date): { body: string; contentType: string } {
  const boundary = `----launchpad-grants-${Math.random().toString(36).slice(2)}`;
  const part = (name: string, json: unknown): string =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(json)}\r\n`;
  const body =
    part('query', buildSediaQuery(now)) +
    part('languages', ['en']) +
    part('sort', { field: 'identifier', order: 'ASC' }) +
    `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function first(result: SediaResult, key: string): string | undefined {
  const v = result.metadata?.[key];
  if (!Array.isArray(v)) return undefined;
  const s = v[0];
  return typeof s === 'string' && s.length > 0 ? s : undefined;
}

function hasNonEmptyString(result: SediaResult, key: string): boolean {
  const v = result.metadata?.[key];
  return Array.isArray(v) && v.some((s) => typeof s === 'string' && s.length > 0);
}

/**
 * Typed-field normalisation. Returns null (and never a guess) when the row
 * cannot be trusted. Order of checks:
 *   1. identifier present
 *   2. type === '1' (topic)
 *   3. status === Open — NEGATIVE filter only; see the header comment
 *   4. deadlineDate present (SEDIA has no rolling concept under this filter:
 *      a missing date is a data defect → warn and skip)
 *   5. max parsed deadline is today's UTC date or later — the ONLY positive
 *      open-ness decision. Two-stage / multi-cut-off rows carry several
 *      deadlineDate values; the LAST one is the call's deadline.
 */
export function normalizeSediaResult(result: SediaResult, now: Date): NormalizedCall | null {
  const identifier = first(result, 'identifier');
  if (!identifier) return null;
  if (first(result, 'type') !== '1') return null;
  if (first(result, 'status') !== SEDIA_STATUS_OPEN) return null;

  const deadlineDates = (result.metadata?.deadlineDate ?? []).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  if (deadlineDates.length === 0) {
    console.warn('[grants] sedia: no deadlineDate for', identifier);
    return null;
  }

  const parsed = deadlineDates.map(parseIsoDeadline);
  const deadline = maxIsoDate(parsed);
  if (deadline === null) {
    console.warn('[grants] sedia: unparseable deadlineDate for', identifier, deadlineDates.join(' | '));
    return null;
  }
  // Status is not trusted (see header): a row is emitted only when its
  // deadline is today or later. Past rows are dropped here even though the
  // API labelled them Open; a deadline-day row is still open (unknown hour).
  if (!isTodayOrFuture(deadline, now)) return null;

  const rawIndex = parsed.findIndex((d) => d === deadline);
  const rawSnippet = deadlineDates[rawIndex];

  const title = (first(result, 'title') ?? first(result, 'callTitle') ?? identifier).trim();
  const programme = first(result, 'frameworkProgramme') ?? '';
  const typeOfAction = first(result, 'typesOfAction');
  const grantingBody =
    SEDIA_PROGRAMME_LABELS[programme] ?? (typeOfAction ? `EU — ${typeOfAction}` : 'European Commission');
  const conditions = first(result, 'topicConditions');
  const eligibility = conditions ? excerpt(stripHtml(conditions), 1500) : null;

  return {
    source: 'sedia',
    source_identifier: identifier,
    official_url: SEDIA_TOPIC_URL_PREFIX + identifier.toLowerCase(),
    title: title.length > 0 ? title : identifier,
    granting_body: grantingBody,
    deadline,
    // The T00:00 / T17:00 values in deadlineDate are index artifacts, not the
    // Brussels-time deadline — never surface them as a time.
    deadline_time: null,
    status: 'open',
    eligibility_text: eligibility && eligibility.length > 0 ? eligibility : null,
    raw_snippet: rawSnippet,
    parse_method: 'iso_field',
    // Everything above came from the API — there is no page to read.
    page_status: 'n/a',
    page_error: null,
  };
}

function isComplete(r: SediaResult): boolean {
  return hasNonEmptyString(r, 'status') && hasNonEmptyString(r, 'deadlineDate');
}

/**
 * Dedupe by identifier. Prefer DATASOURCE=SEDIA over anything else (the
 * SEDIA_PRD_CENTRICITY rows are stale duplicates); within the same DATASOURCE
 * prefer a row that has both status and deadlineDate. Otherwise keep the first
 * seen (identifier-ASC page order makes this deterministic).
 */
function shouldReplace(existing: SediaResult, candidate: SediaResult): boolean {
  const existingDs = first(existing, 'DATASOURCE');
  const candidateDs = first(candidate, 'DATASOURCE');
  if (candidateDs === 'SEDIA' && existingDs !== 'SEDIA') return true;
  if (candidateDs === existingDs && isComplete(candidate) && !isComplete(existing)) return true;
  return false;
}

function dedupeResults(results: SediaResult[]): SediaResult[] {
  const byId = new Map<string, SediaResult>();
  for (const r of results) {
    const id = first(r, 'identifier');
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, r);
      continue;
    }
    if (shouldReplace(existing, r)) {
      byId.set(id, r);
    } else if (
      first(existing, 'DATASOURCE') === first(r, 'DATASOURCE') &&
      isComplete(existing) &&
      isComplete(r) &&
      (existing.metadata?.deadlineDate ?? []).join('|') !== (r.metadata?.deadlineDate ?? []).join('|')
    ) {
      // Same source, both complete, different deadlines: we keep the first and
      // say so — a founder-facing date should never be silently picked.
      console.warn(
        '[grants] sedia: conflicting deadlineDate for',
        id,
        'kept',
        (existing.metadata?.deadlineDate ?? []).join('|'),
        'dropped',
        (r.metadata?.deadlineDate ?? []).join('|'),
      );
    }
  }
  return [...byId.values()];
}

/**
 * Fetch every Open topic (identifier ASC, paginated to totalResults, capped at
 * maxPages) and normalise. THROWS on HTTP non-2xx or a malformed body — never
 * returns [] for a broken source. `complete` is false when the page cap cut
 * the listing short: the calls are still returned (identifier-ASC makes the
 * truncation deterministic) but the caller must not infer closure from
 * absence.
 */
export async function fetchSediaListing(opts: SediaOptions): Promise<ConnectorResult> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const now = opts.now;

  const collected: SediaResult[] = [];
  let totalResults: number | null = null;
  let exhausted = false;

  for (let page = 1; page <= maxPages; page++) {
    const { body, contentType } = buildSediaMultipart(now);
    const url = `${SEDIA_SEARCH_URL}?apiKey=SEDIA&text=***&pageSize=${pageSize}&pageNumber=${page}`;
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; SenseFound/1.0)',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = `[grants] sedia HTTP ${res.status} on page ${page}: ${text.slice(0, 200)}`;
      console.error(message);
      throw new Error(message);
    }

    const text = await res.text();
    let json: SediaEnvelope;
    try {
      json = JSON.parse(text) as SediaEnvelope;
    } catch {
      const message = `[grants] sedia: malformed JSON on page ${page}: ${text.slice(0, 200)}`;
      console.error(message);
      throw new Error(message);
    }
    if (!json || typeof json !== 'object' || !Array.isArray(json.results)) {
      const message = `[grants] sedia: malformed envelope (no results[]) on page ${page}`;
      console.error(message);
      throw new Error(message);
    }

    const results = json.results as SediaResult[];
    if (typeof json.totalResults === 'number' && Number.isFinite(json.totalResults)) {
      totalResults = json.totalResults;
    } else if (totalResults === null) {
      console.warn('[grants] sedia: envelope has no numeric totalResults; paginating until an empty page');
    }

    collected.push(...results);

    if (results.length === 0) {
      exhausted = true;
      break;
    }
    if (totalResults !== null && page * pageSize >= totalResults) {
      exhausted = true;
      break;
    }
    if (totalResults === null && results.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  if (!exhausted) {
    console.warn(
      totalResults !== null
        ? `[grants] sedia truncated: totalResults=${totalResults} > maxPages*pageSize=${maxPages * pageSize} — listing INCOMPLETE, the sync will not close missing calls`
        : `[grants] sedia truncated: totalResults unknown and ${maxPages} full page(s) fetched — listing INCOMPLETE, the sync will not close missing calls`,
    );
  }

  const deduped = dedupeResults(collected);
  const calls: NormalizedCall[] = [];
  for (const r of deduped) {
    const call = normalizeSediaResult(r, now);
    if (call) calls.push(call);
  }
  return { calls, complete: exhausted };
}

/** Calls only (dry-run script / tests). See fetchSediaListing for the completeness flag. */
export async function fetchSediaCalls(opts: SediaOptions): Promise<NormalizedCall[]> {
  return (await fetchSediaListing(opts)).calls;
}

export const sediaConnector: SourceConnector = {
  source: 'sedia',
  fetchCalls: (o) => fetchSediaListing(o),
};
