/**
 * incentivi.gov.it — MIMIT's national incentives catalogue, read through the
 * public Solr index its own catalogue page queries (found by watching the
 * page's network traffic; `/jsonapi` is disabled). One anonymous GET returns
 * EVERY record — ~5,800 on 2026-09-02, ~830 open/rolling — national and
 * regional, so this single source covers all 20 Italian regions.
 *
 * What the index gives us, typed (profiled on the full payload, 2026-09-02):
 *   - zs_field_close_date / zs_field_open_date  ISO 'YYYY-MM-DDT00:00:00'
 *   - zs_field_link      the granting body's OWN page (100% present) — official_url
 *   - zs_url             the catalogue entry — catalog_url
 *   - zm_field_regions_value  region NAMES; national measures are tagged with
 *                        all 20 regions (77 of 837 open) — we call >= 15 "national"
 *   - zs_body            HTML with "A chi si rivolge" / "Cosa prevede" headings on
 *                        100% of open records — eligibility_text is the slice between them
 *   - zs_field_close_date_descriptor  free text ("procedura a sportello",
 *                        "chiusura ad esaurimento risorse"); in 40 of 386 cases it
 *                        carries a DIFFERENT date than the typed field — it is
 *                        surfaced as source_note and used ONLY as a rolling signal,
 *                        never parsed for a deadline
 *   - beneficiary / scope / support-form / ATECO facets for the relevance layer
 *
 * Rules that exist because the data showed the trap:
 *   - open-ness from typed dates in code (past close ⇒ drop; future open ⇒ drop as
 *     "in arrivo"); never from text
 *   - rolling = no close date, OR a formal far-future close (>= 2029, e.g.
 *     09/09/2030), OR a sportello/esaurimento descriptor
 *   - year-end (31/12) closes are real formal deadlines — kept as 'open'
 *   - 62 official links are shared by >1 record (same fund via different
 *     intermediaries): collapse by official link, keep the most recently updated
 *   - completeness: numFound must equal the rows returned, else `complete=false`
 *     and the sync never closes calls from this run
 * page_status is 'n/a': there is no page to read — everything is in the index.
 */
import type { ConnectorOptions, ConnectorResult, FundingFacets, NormalizedCall, SourceConnector } from '../types';
import { parseIsoDeadline, isTodayOrFuture, isFutureDate, toDateOnly } from '../dates';
import { stripHtml, decodeHtmlEntities } from '../text';

export const INCENTIVI_SOLR_URL = 'https://www.incentivi.gov.it/solr/coredrupal/select';
export const INCENTIVI_SITE = 'https://www.incentivi.gov.it';
export const INCENTIVI_ROWS = 8000;
/** Tagged with at least this many regions ⇒ a national measure. */
export const INCENTIVI_NATIONAL_MIN_REGIONS = 15;
/** A formal close date this far out is "until funds run out" in practice. */
export const INCENTIVI_ROLLING_YEAR = 2029;
const TIMEOUT_MS = 60_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; SenseFound/1.0)';
const ELIGIBILITY_MAX = 2000;

const FL = [
  'nid:zs_nid', 'title:zs_title', 'url:zs_url', 'link:zs_field_link',
  'close:zs_field_close_date', 'open:zs_field_open_date', 'desc:zs_field_close_date_descriptor',
  'multi:zs_field_multibando', 'grant:zs_field_subject_grant',
  'regions:zm_field_regions_value', 'subjects:zm_field_subject_type_value',
  'scopes:zm_field_scopes_value', 'forms:zm_field_support_form_value',
  'ateco:zs_field_ateco', 'upd:ds_last_update', 'body:zs_body',
].join(',');

export function buildIncentiviUrl(rows = INCENTIVI_ROWS): string {
  const p = new URLSearchParams({ wt: 'json', rows: String(rows), q: 'index_id:incentivi', sort: 'ds_last_update desc', fl: FL });
  return `${INCENTIVI_SOLR_URL}?${p.toString()}`;
}

/** Raw record as the index returns it (only the aliased fields above). */
export interface IncentiviDoc {
  nid?: string | number;
  title?: string;
  url?: string;
  link?: string;
  close?: string | null;
  open?: string | null;
  desc?: string | null;
  multi?: string | number | null;
  grant?: string | null;
  regions?: string[] | string | null;
  subjects?: string[] | string | null;
  scopes?: string[] | string | null;
  forms?: string[] | string | null;
  ateco?: string | null;
  upd?: string | null;
  body?: string | null;
}

const ROLLING_RE = /sportello|esaurimento|senza chiusura|fino ad esaurimento|non (?:è )?prevista (?:una )?scadenza/i;
/** A shortened link is not a verifiable official page — the catalogue entry is used instead. */
export const URL_SHORTENER_HOSTS: ReadonlySet<string> = new Set(['tinyurl.com', 'bit.ly', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at']);
export function isShortenedUrl(url: string): boolean {
  try { return URL_SHORTENER_HOSTS.has(new URL(url).hostname.replace(/^www\./, '').toLowerCase()); } catch { return true; }
}

function arr(v: string[] | string | null | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return [v.trim()];
  return [];
}

/** Eligibility = the "A chi si rivolge" section of the body, up to "Cosa prevede". */
export function extractEligibility(bodyHtml: string | null | undefined): string | null {
  if (!bodyHtml) return null;
  const text = decodeHtmlEntities(stripHtml(bodyHtml.replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')));
  const i = text.search(/A chi si rivolge/i);
  if (i < 0) return null;
  let s = text.slice(i + 'A chi si rivolge'.length);
  const j = s.search(/Cosa prevede|Cosa finanzia|Come funziona/i);
  if (j >= 0) s = s.slice(0, j);
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (!s) return null;
  return s.length > ELIGIBILITY_MAX ? s.slice(0, ELIGIBILITY_MAX - 1) + '…' : s;
}

/**
 * Null ⇒ not a call we surface: no identifier/title/official link, closed
 * (past typed close date), or not yet open (typed open date in the future).
 */
export function normalizeIncentiviDoc(doc: IncentiviDoc, now: Date): NormalizedCall | null {
  const nid = doc.nid === undefined || doc.nid === null ? '' : String(doc.nid).trim();
  const title = (doc.title ?? '').trim();
  const link = (doc.link ?? '').trim();
  if (!nid || !title) return null;
  if (!/^https?:\/\//i.test(link)) {
    console.warn('[grants] incentivi: record without an official link skipped:', nid, title.slice(0, 60));
    return null;
  }
  const today = toDateOnly(now);
  const openDate = doc.open ? parseIsoDeadline(String(doc.open).slice(0, 10)) : null;
  if (doc.open && !openDate) console.warn('[grants] incentivi: unparseable open date on', nid, doc.open);
  if (openDate && isFutureDate(openDate, today)) return null; // "in arrivo" — not open yet

  let deadline: string | null = null;
  if (doc.close) {
    deadline = parseIsoDeadline(String(doc.close).slice(0, 10));
    if (!deadline) {
      console.warn('[grants] incentivi: unparseable close date dropped:', nid, doc.close);
      return null; // a garbage date must never become open or rolling
    }
    if (!isTodayOrFuture(deadline, today)) return null; // closed
  }
  const desc = (doc.desc ?? '').trim();
  const farFuture = deadline !== null && Number(deadline.slice(0, 4)) >= INCENTIVI_ROLLING_YEAR;
  const rolling = deadline === null || farFuture || ROLLING_RE.test(desc);

  const regions = arr(doc.regions);
  const national = regions.length >= INCENTIVI_NATIONAL_MIN_REGIONS;
  const facets: FundingFacets = {
    subject_types: arr(doc.subjects),
    scopes: arr(doc.scopes),
    support_forms: arr(doc.forms),
    ateco: (doc.ateco ?? '').trim() || null,
    national,
  };
  const catalogPath = (doc.url ?? '').trim();
  const catalogUrl = catalogPath ? INCENTIVI_SITE + catalogPath : null;
  // Third-party links may legitimately be plain http; a URL shortener is not
  // a verifiable official page, so the catalogue entry stands in for it.
  let officialUrl = link;
  if (isShortenedUrl(link)) {
    if (!catalogUrl) {
      console.warn('[grants] incentivi: shortened official link and no catalogue page — skipped:', nid);
      return null;
    }
    console.warn('[grants] incentivi: shortened official link replaced by the catalogue page:', nid, link);
    officialUrl = catalogUrl;
  }

  return {
    source: 'incentivi',
    source_identifier: nid,
    official_url: officialUrl,
    title,
    granting_body: (doc.grant ?? '').trim() || null,
    deadline: rolling && farFuture ? deadline : rolling ? null : deadline,
    deadline_time: null,
    status: rolling ? 'rolling' : 'open',
    eligibility_text: extractEligibility(doc.body),
    raw_snippet: deadline ? String(doc.close) : '',
    parse_method: 'iso_field',
    page_status: 'n/a',
    page_error: null,
    regions: national ? regions : regions.length ? regions : null,
    facets,
    source_note: desc.replace(/^[-/\s]+$/, '').trim() || null,
    catalog_url: catalogUrl,
  };
}

/** Collapse records that share an official link — keep the most recently updated. */
export function dedupeByOfficialLink(calls: Array<NormalizedCall & { _upd?: string | null }>): NormalizedCall[] {
  const byLink = new Map<string, NormalizedCall & { _upd?: string | null }>();
  for (const c of calls) {
    const key = c.official_url.trim().toLowerCase();
    const prev = byLink.get(key);
    if (!prev || String(c._upd ?? '') > String(prev._upd ?? '')) byLink.set(key, c);
  }
  return [...byLink.values()].map((c) => {
    const copy: NormalizedCall & { _upd?: string | null } = { ...c };
    delete copy._upd;
    return copy as NormalizedCall;
  });
}

export async function fetchIncentiviListing(opts: ConnectorOptions): Promise<ConnectorResult> {
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const url = buildIncentiviUrl();
  const res = await fetchFn(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error('[grants] incentivi: solr HTTP', res.status);
    throw new Error(`[grants] incentivi solr HTTP ${res.status}`);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await res.text());
  } catch (err) {
    console.error('[grants] incentivi: malformed JSON:', (err as Error).message);
    throw new Error('[grants] incentivi: malformed solr payload');
  }
  const response = (payload as { response?: { numFound?: number; docs?: unknown } })?.response;
  if (!response || !Array.isArray(response.docs)) {
    console.error('[grants] incentivi: envelope without response.docs');
    throw new Error('[grants] incentivi: malformed solr payload (no docs)');
  }
  const docs = response.docs as IncentiviDoc[];
  const numFound = typeof response.numFound === 'number' ? response.numFound : null;
  const complete = numFound !== null && numFound === docs.length;
  if (!complete) {
    console.warn(`[grants] incentivi truncated: numFound=${numFound} but ${docs.length} rows returned — listing INCOMPLETE, the sync will not close missing calls`);
  }
  const normalized: Array<NormalizedCall & { _upd?: string | null }> = [];
  for (const doc of docs) {
    if (!doc || typeof doc !== 'object') continue;
    const call = normalizeIncentiviDoc(doc, opts.now);
    if (call) normalized.push({ ...call, _upd: doc.upd ?? null });
  }
  const calls = dedupeByOfficialLink(normalized);
  console.log(`[grants] incentivi: ${docs.length} records, ${normalized.length} open/rolling, ${calls.length} after collapsing shared official links`);
  return { calls, complete };
}

/** Calls only (dry-run script / tests). */
export async function fetchIncentiviCalls(opts: ConnectorOptions): Promise<NormalizedCall[]> {
  return (await fetchIncentiviListing(opts)).calls;
}

export const incentiviConnector: SourceConnector = {
  source: 'incentivi',
  fetchCalls: (o) => fetchIncentiviListing(o),
};
