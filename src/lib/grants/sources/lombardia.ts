/**
 * Regione Lombardia connector — "Bandi e Servizi" open calls.
 *
 * Two typed sources, both parsed in code (never by a model):
 *
 *  1. Socrata open-data dataset bukx-h2uy (one row per call). Column names were
 *     confirmed live against the Socrata metadata: codice_bando, titolo_bando,
 *     direzione_generale, ente, apertura_adesione, chiusura_adesione,
 *     tipo_strumento, presentato. `chiusura_adesione` is a date-only timestamp
 *     ('2026-09-07T00:00:00.000'); a NULL closing date while the call is listed
 *     open means a sportello / until-funds-exhausted call → status 'rolling'.
 *
 *  2. The public detail page, fetched ONLY for identifiers the sync asks for
 *     (`needsDetail`: new / never-enriched calls) and bounded by
 *     `maxDetailFetches` + `detailBudgetMs`. It carries what Socrata lacks:
 *     the closing HOUR ('ore 12:00', Europe/Rome), the latest proroga, and the
 *     "Chi può partecipare" eligibility block. official_url is the sitemap's
 *     CANONICAL /bandi/dettaglio/<category>/<sub>/<slug>-<CODICE> path, with the
 *     bare-codice URL as fallback — measured 2026-09-02 on all 171 stored calls:
 *     the bare form 404s for 4 (2.3%) and is intermittent for others, while the
 *     canonical form resolved for every one; the 3 codes the sitemap lacks all
 *     resolve bare. One ~5 MB sitemap fetch per daily sync.
 *
 * Failure policy — dates are what founders plan applications around, so a
 * wrong date is worse than no result:
 *  - Socrata non-2xx or a malformed body THROWS (the sync records the error and
 *    never marks anything closed on a failed fetch).
 *  - A detail-page failure degrades to "keep the Socrata date, no time, no
 *    eligibility" with a '[grants]' warn — enrichment is never a gate.
 *  - A detail page whose two deadline fields disagree, or whose deadline is in
 *    the past while the chip says the call is open, is treated as unreliable:
 *    the Socrata date is kept and the contradiction is logged.
 *  - Unparseable typed fields drop the row loudly; they never become 'rolling'.
 *  - A Socrata page that hits LOMBARDIA_SOCRATA_LIMIT rows is reported as
 *    `complete: false` (fetchLombardiaListing): what was fetched is still
 *    upserted, but the sync must not treat absence from it as closure.
 *
 * Known limitation (UNCONFIRMED whether Regione backfills chiusura_adesione
 * when a sportello closes): a rolling call that closes at source without a
 * backfilled closing date stays 'rolling' until its apertura_adesione ages
 * past LOMBARDIA_ROLLING_MAX_AGE_DAYS, drops out of the Socrata query, and is
 * closed by the sync's missed-syncs rule.
 *
 * Imports are relative on purpose: scripts/grants-sync-dryrun.mjs loads this
 * file with tsx and no '@/lib/db' must ever be reachable from a connector.
 */

import type { ConnectorResult, LombardiaOptions, NormalizedCall, SourceConnector } from '../types';
import {
  isTodayOrFuture,
  parseIsoDeadline,
  parseItalianDate,
  parseTimeHHMM,
  toDateOnly,
} from '../dates';
import { excerpt, stripHtml } from '../text';

export const LOMBARDIA_SOCRATA_URL = 'https://www.dati.lombardia.it/resource/bukx-h2uy.json';
export const LOMBARDIA_DETAIL_URL_PREFIX =
  'https://www.bandi.regione.lombardia.it/servizi/servizio/bandi/dettaglio/';
export const LOMBARDIA_ROLLING_MAX_AGE_DAYS = 365;
/** Socrata $limit. A response with this many rows may be truncated (expected ~150–180). */
export const LOMBARDIA_SOCRATA_LIMIT = 1000;
export const LOMBARDIA_SITEMAP_URL = 'https://www.bandi.regione.lombardia.it/servizi/sitemap.xml';
const SITEMAP_TIMEOUT_MS = 20_000;
export const LOMBARDIA_EXCLUDED_INSTRUMENTS: readonly string[] = [
  'Concorsi Pubblici e Avvisi sul Personale',
];

const USER_AGENT = 'Mozilla/5.0 (compatible; SenseFound/1.0)';
const SOCRATA_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 15_000;
const DAY_MS = 86_400_000;

export interface SocrataRow {
  codice_bando: string;
  titolo_bando: string;
  direzione_generale?: string;
  ente?: string;
  apertura_adesione: string;
  chiusura_adesione?: string | null;
  tipo_strumento?: string;
  presentato?: string;
}

export interface LombardiaDetail {
  status: 'aperto' | 'chiuso' | 'in_apertura' | 'unknown';
  /** 'YYYY-MM-DD' parsed from a typed page field, or null. */
  deadline: string | null;
  /** 'HH:MM' Europe/Rome, or null. */
  deadline_time: string | null;
  /** Exact page substring the deadline came from, or null. */
  raw_snippet: string | null;
  eligibility_text: string | null;
  funding_source: string | null;
  granting_body: string | null;
  /** True when the site answered with its "Errore" page (unknown codice → HTTP 200). */
  not_found: boolean;
}

// ─── URLs ────────────────────────────────────────────────────────────────────

/**
 * Open calls as of `now`: already opened, and either closing today-or-later or
 * closing-date-less but opened within the rolling window (so stale sportelli
 * eventually drop out — see the header).
 */
export function buildSocrataUrl(now: Date): string {
  const today = toDateOnly(now);
  const yearAgo = toDateOnly(new Date(now.getTime() - LOMBARDIA_ROLLING_MAX_AGE_DAYS * DAY_MS));
  const where =
    `apertura_adesione <= '${today}T23:59:59' AND ` +
    `(chiusura_adesione >= '${today}T00:00:00' OR ` +
    `(chiusura_adesione IS NULL AND apertura_adesione >= '${yearAgo}T00:00:00'))`;
  return `${LOMBARDIA_SOCRATA_URL}?$limit=${LOMBARDIA_SOCRATA_LIMIT}&$order=chiusura_adesione&$where=${encodeURIComponent(where)}`;
}

/** Bare-codice detail URL — the FALLBACK when the sitemap has no canonical entry
 *  (works for most codes, 404s for ~2% — see parseSitemapCanonicalUrls). */
export function lombardiaDetailUrl(codice: string): string {
  return LOMBARDIA_DETAIL_URL_PREFIX + encodeURIComponent(codice.trim());
}

/**
 * Canonical detail URLs from the portal sitemap, keyed by codice. Each detail
 * <loc> ends in `-<CODICE>`; the same call appears under /bandi/dettaglio/ and
 * /catalogo/dettaglio/ — /bandi/ is preferred. Pure; the fetch is separate.
 */
export function parseSitemapCanonicalUrls(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const loc = m[1].trim();
    if (!loc.includes('/dettaglio/')) continue;
    const tail = loc.match(/-([A-Z][A-Z0-9_]{5,})$/);
    if (!tail) continue;
    const codice = tail[1];
    const prev = out.get(codice);
    if (!prev || (loc.includes('/bandi/dettaglio/') && !prev.includes('/bandi/dettaglio/'))) {
      out.set(codice, loc);
    }
  }
  return out;
}

/** One sitemap fetch per run. Any failure ⇒ null ⇒ bare-codice URLs (never drops a call). */
async function fetchSitemapCanonicalUrls(fetchFn: FetchFn): Promise<Map<string, string> | null> {
  try {
    const res = await fetchFn(LOMBARDIA_SITEMAP_URL, {
      headers: { Accept: 'application/xml,text/xml', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[grants] lombardia sitemap unavailable — bare-codice URLs this run:', `HTTP ${res.status}`);
      return null;
    }
    const map = parseSitemapCanonicalUrls(await res.text());
    if (map.size === 0) {
      console.warn('[grants] lombardia sitemap parsed to 0 detail URLs — bare-codice URLs this run');
      return null;
    }
    return map;
  } catch (err) {
    console.warn('[grants] lombardia sitemap unavailable — bare-codice URLs this run:', (err as Error).message);
    return null;
  }
}

// ─── Socrata row → NormalizedCall ────────────────────────────────────────────

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Null means "not a call we surface": no identifier, an excluded instrument
 * (public-sector job competitions), not yet open, already closed, or a typed
 * date field the code cannot parse (logged — a garbage value must never turn
 * into 'rolling' or 'open').
 */
export function normalizeSocrataRow(row: SocrataRow, now: Date): NormalizedCall | null {
  const codice = nonEmpty(row?.codice_bando);
  if (!codice) {
    console.warn('[grants] lombardia: socrata row without codice_bando skipped');
    return null;
  }
  const instrument = nonEmpty(row.tipo_strumento);
  if (instrument && LOMBARDIA_EXCLUDED_INSTRUMENTS.includes(instrument)) return null;

  const today = toDateOnly(now);
  const opening = parseIsoDeadline(row.apertura_adesione);
  if (!opening) {
    console.warn('[grants] lombardia: unparseable apertura_adesione for', codice, String(row.apertura_adesione));
    return null;
  }
  if (opening > today) return null; // not open yet — the Socrata filter should already exclude it

  const rawClosing = nonEmpty(row.chiusura_adesione);
  let deadline: string | null;
  let status: NormalizedCall['status'];
  let rawSnippet: string;
  if (rawClosing === null) {
    status = 'rolling';
    deadline = null;
    rawSnippet = '';
  } else {
    const closing = parseIsoDeadline(rawClosing);
    if (!closing) {
      console.warn('[grants] lombardia: unparseable chiusura_adesione for', codice, rawClosing);
      return null;
    }
    if (!isTodayOrFuture(closing, today)) return null; // already closed
    status = 'open';
    deadline = closing;
    rawSnippet = row.chiusura_adesione as string; // verbatim source value
  }

  const ente = nonEmpty(row.ente) ?? 'Regione Lombardia';
  const direzione = nonEmpty(row.direzione_generale);

  return {
    source: 'lombardia',
    source_identifier: codice,
    official_url: lombardiaDetailUrl(codice),
    title: nonEmpty(row.titolo_bando) ?? codice,
    granting_body: direzione ? `${ente} — ${direzione}` : ente,
    deadline,
    deadline_time: null,
    status,
    eligibility_text: null,
    raw_snippet: rawSnippet,
    parse_method: 'socrata_field',
  };
}

// ─── Detail page → LombardiaDetail ───────────────────────────────────────────

const RE_NOT_FOUND = /<title>\s*Errore\s*\|/i;
const RE_STATUS_CHIP =
  /<div class="chip[^"]*bg-(success|danger|warning)-state">\s*<span class="chip-label[^"]*">([^<]+)<\/span>/;
const RE_CLOSE_DATE_HIDDEN =
  /<input type="hidden" class="checkCloseDate" value="(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})"/;
const RE_SCADE_IL =
  /Scade il:\s*<strong data-entity="chiusura">\s*(\d{2}\/\d{2}\/\d{4})\s*,<\/strong>\s*ore\s*(\d{1,2}[:.]\d{2})/;
const RE_ELIGIBILITY =
  /<div id="partecipanti"[\s\S]*?<div class="item_text-description[^"]*">([\s\S]*?)<\/div>\s*<\/li>/;
const RE_FUNDING_SOURCE = /<small>Fonti di finanziamento<\/small>[\s\S]*?<span>([^<]+)<\/span>/;
const RE_GRANTING_BODY = /<small>Ente responsabile<\/small>[\s\S]*?<a [^>]*title="([^"]+)"/;

function chipStatus(label: string): LombardiaDetail['status'] {
  const l = label.trim().toLowerCase();
  if (l === 'aperto') return 'aperto';
  if (l === 'chiuso') return 'chiuso';
  if (l === 'in apertura') return 'in_apertura';
  return 'unknown';
}

interface PageDeadline {
  deadline: string;
  time: string | null;
  snippet: string;
}

/**
 * Regex-only (no DOM lib). Deadline priority: the machine-readable hidden
 * `checkCloseDate` input, then the human "Scade il: … ore HH:MM" line. When
 * both are present and disagree on the DATE the page is unreliable → no
 * deadline (the caller keeps the Socrata date) and a loud warn.
 */
export function parseLombardiaDetail(html: string): LombardiaDetail {
  const detail: LombardiaDetail = {
    status: 'unknown',
    deadline: null,
    deadline_time: null,
    raw_snippet: null,
    eligibility_text: null,
    funding_source: null,
    granting_body: null,
    not_found: RE_NOT_FOUND.test(html),
  };
  if (detail.not_found) return detail;

  const chip = RE_STATUS_CHIP.exec(html);
  if (chip) detail.status = chipStatus(chip[2]);

  // (a) hidden machine field
  let hidden: PageDeadline | null = null;
  const h = RE_CLOSE_DATE_HIDDEN.exec(html);
  if (h) {
    const d = parseIsoDeadline(h[1]);
    if (d) hidden = { deadline: d, time: parseTimeHHMM(h[2]), snippet: h[0] };
    else console.warn('[grants] lombardia detail: impossible checkCloseDate ignored:', h[1]);
  }

  // (b) human-readable line
  let scade: PageDeadline | null = null;
  const s = RE_SCADE_IL.exec(html);
  if (s) {
    const d = parseItalianDate(s[1]);
    if (d) scade = { deadline: d, time: parseTimeHHMM(s[2]), snippet: s[0].replace(/\s+/g, ' ') };
    else console.warn('[grants] lombardia detail: impossible "Scade il" date ignored:', s[1]);
  }

  if (hidden && scade && hidden.deadline !== scade.deadline) {
    console.warn(
      '[grants] lombardia detail: checkCloseDate and "Scade il" disagree, page deadline ignored:',
      hidden.deadline,
      'vs',
      scade.deadline,
    );
  } else {
    const chosen = hidden ?? scade;
    if (chosen) {
      detail.deadline = chosen.deadline;
      detail.deadline_time = chosen.time;
      detail.raw_snippet = chosen.snippet;
    }
  }

  const elig = RE_ELIGIBILITY.exec(html);
  if (elig) {
    const text = excerpt(stripHtml(elig[1]), 1500);
    detail.eligibility_text = text.length > 0 ? text : null;
  }

  const fs = RE_FUNDING_SOURCE.exec(html);
  if (fs) detail.funding_source = nonEmpty(fs[1]);

  const gb = RE_GRANTING_BODY.exec(html);
  if (gb) detail.granting_body = nonEmpty(gb[1]);

  return detail;
}

/**
 * Merge a detail page into a Socrata-derived call.
 *  - not_found      → call unchanged (warn).
 *  - chip 'chiuso'  → null: the connector never emits closed; the sync counts
 *                     the identifier as missing and closes it after 2 syncs.
 *  - page deadline  → wins over Socrata (it carries the hour and the latest
 *                     proroga) UNLESS it is already past while the chip says
 *                     the call is open (contradiction → Socrata date kept, warn).
 *                     `now` is optional so the spec signature still holds; the
 *                     connector always passes it.
 *  - otherwise      → Socrata status/date kept.
 * Eligibility and the funding-source suffix are applied in every non-null path.
 */
export function applyDetail(call: NormalizedCall, detail: LombardiaDetail, now?: Date): NormalizedCall | null {
  if (detail.not_found) {
    console.warn('[grants] lombardia detail: page not found for', call.source_identifier, '(kept Socrata data)');
    return call;
  }
  if (detail.status === 'chiuso') {
    console.warn(
      '[grants] lombardia detail: chip says Chiuso for',
      call.source_identifier,
      '— dropped from this run (sync closes after 2 misses)',
    );
    return null;
  }

  let next: NormalizedCall = { ...call };
  if (detail.deadline && detail.raw_snippet) {
    const pastWhileOpen = now !== undefined && !isTodayOrFuture(detail.deadline, now);
    if (pastWhileOpen) {
      console.warn(
        '[grants] lombardia detail: page deadline already past while chip is',
        detail.status,
        'for',
        call.source_identifier,
        `(${detail.deadline}) — Socrata date kept`,
      );
    } else {
      next = {
        ...next,
        status: 'open',
        deadline: detail.deadline,
        deadline_time: detail.deadline_time,
        raw_snippet: detail.raw_snippet,
        parse_method: 'regex',
      };
    }
  }

  next.eligibility_text = detail.eligibility_text ?? call.eligibility_text;
  if (detail.funding_source) {
    const base = call.granting_body ?? detail.granting_body ?? 'Regione Lombardia';
    next.granting_body = `${base} (${detail.funding_source})`;
  } else if (!call.granting_body && detail.granting_body) {
    next.granting_body = detail.granting_body;
  }
  return next;
}

// ─── Fetching ────────────────────────────────────────────────────────────────

type FetchFn = NonNullable<LombardiaOptions['fetch']>;

async function fetchSocrataRows(fetchFn: FetchFn, now: Date): Promise<SocrataRow[]> {
  const url = buildSocrataUrl(now);
  const res = await fetchFn(url, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(SOCRATA_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[grants] lombardia socrata HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('[grants] lombardia: malformed socrata payload');
  }
  if (!Array.isArray(json)) throw new Error('[grants] lombardia: malformed socrata payload');
  const rows: SocrataRow[] = [];
  for (const item of json) {
    if (item && typeof item === 'object' && !Array.isArray(item)) rows.push(item as SocrataRow);
    else console.warn('[grants] lombardia: non-object socrata row skipped');
  }
  return rows;
}

/**
 * Socrata listing + bounded detail enrichment. `complete` is false when the
 * Socrata response filled the whole $limit page — the rows are still returned
 * but the caller must not infer closure from absence.
 */
export async function fetchLombardiaListing(opts: LombardiaOptions): Promise<ConnectorResult> {
  const fetchFn: FetchFn = opts.fetch ?? globalThis.fetch;
  const resolveDetails = opts.resolveDetails ?? true;
  const maxDetail = opts.maxDetailFetches ?? 10;
  const budget = opts.detailBudgetMs ?? 30_000;
  const now = opts.now;

  const rows = await fetchSocrataRows(fetchFn, now);
  const complete = rows.length < LOMBARDIA_SOCRATA_LIMIT;
  if (!complete) {
    console.warn(
      `[grants] lombardia truncated: socrata returned ${rows.length} rows = $limit ${LOMBARDIA_SOCRATA_LIMIT} — listing INCOMPLETE, the sync will not close missing calls`,
    );
  }

  // Dedupe by identifier, last row wins (Socrata is ordered by chiusura_adesione).
  const byId = new Map<string, NormalizedCall>();
  for (const row of rows) {
    const call = normalizeSocrataRow(row, now);
    if (call) byId.set(call.source_identifier, call);
  }

  // Canonical official_url from the sitemap, bare-codice fallback — see
  // parseSitemapCanonicalUrls for the measured reason. One fetch per run.
  if ((opts.resolveCanonicalUrls ?? true) && byId.size > 0) {
    const canon = await fetchSitemapCanonicalUrls(fetchFn);
    if (canon) {
      let resolved = 0;
      for (const [id, call] of byId) {
        const url = canon.get(id);
        if (url && url !== call.official_url) {
          byId.set(id, { ...call, official_url: url });
          resolved++;
        }
      }
      console.log(`[grants] lombardia canonical urls: ${resolved}/${byId.size} from sitemap, ${byId.size - resolved} bare`);
    }
  }
  if (!resolveDetails || byId.size === 0) return { calls: [...byId.values()], complete };

  const ids = [...byId.keys()];
  let want: Set<string>;
  try {
    want = opts.needsDetail ? await opts.needsDetail(ids) : new Set(ids);
  } catch (err) {
    console.warn('[grants] lombardia needsDetail failed:', (err as Error).message);
    want = new Set(); // no enrichment this run; Socrata data still flows
  }

  // Rolling calls first: only the page can confirm they are still open.
  const all = [...byId.values()];
  const ordered = [
    ...all.filter((c) => c.status === 'rolling'),
    ...all.filter((c) => c.status !== 'rolling'),
  ].filter((c) => want.has(c.source_identifier));

  const start = Date.now();
  let fetched = 0;
  let index = 0;
  for (; index < ordered.length; index++) {
    const call = ordered[index];
    if (fetched >= maxDetail) break;
    if (Date.now() - start >= budget) {
      console.warn(`[grants] lombardia detail budget exhausted after ${fetched} page(s) (${budget} ms)`);
      break;
    }
    const id = call.source_identifier;
    fetched++;
    try {
      // The canonical URL when resolved above (the bare form 404s for ~2%).
      const res = await fetchFn(call.official_url, {
        headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS),
      });
      if (!res.ok) {
        console.warn('[grants] lombardia detail failed:', id, `HTTP ${res.status}`);
        continue; // keep the Socrata-only call
      }
      const html = await res.text();
      const next = applyDetail(call, parseLombardiaDetail(html), now);
      if (next === null) byId.delete(id);
      else byId.set(id, next);
    } catch (err) {
      console.warn('[grants] lombardia detail failed:', id, (err as Error).message);
    }
  }
  const skipped = ordered.length - index;
  if (skipped > 0) {
    console.log(`[grants] lombardia detail cap reached: ${fetched} fetched, ${skipped} left for the next run`);
  }

  return { calls: [...byId.values()], complete };
}

/** Calls only (dry-run script / tests). See fetchLombardiaListing for the completeness flag. */
export async function fetchLombardiaCalls(opts: LombardiaOptions): Promise<NormalizedCall[]> {
  return (await fetchLombardiaListing(opts)).calls;
}

export const lombardiaConnector: SourceConnector = {
  source: 'lombardia',
  fetchCalls: (o) => fetchLombardiaListing(o),
};
