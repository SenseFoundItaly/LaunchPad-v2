import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LOMBARDIA_SOCRATA_URL,
  LOMBARDIA_DETAIL_URL_PREFIX,
  LOMBARDIA_SITEMAP_URL,
  parseSitemapCanonicalUrls,
  buildSocrataUrl,
  lombardiaDetailUrl,
  parseLombardiaDetail,
  normalizeSocrataRow,
  applyDetail,
  fetchLombardiaCalls,
  fetchLombardiaListing,
  LOMBARDIA_SOCRATA_LIMIT,
  lombardiaConnector,
  type SocrataRow,
} from './lombardia';
import type { FetchLike, NormalizedCall } from '../types';

interface Fixture {
  _source: { socrata_dataset: string; detail_url: string; fetched: string };
  socrata_row: SocrataRow;
  detail_fragments: {
    status_chip: string;
    dates: string;
    fonti_finanziamento: string;
    eligibility_heading: string;
    eligibility_body: string;
  };
}

const fx: Fixture = JSON.parse(
  readFileSync(join(process.cwd(), 'src/lib/grants/__fixtures__/lombardia-sample.json'), 'utf-8'),
);
const f = fx.detail_fragments;

const detailHtml = [
  '<html><head><title>Bandi | Bandi e Servizi</title></head><body>',
  f.status_chip,
  f.dates,
  f.fonti_finanziamento,
  f.eligibility_heading,
  f.eligibility_body,
  '</body></html>',
].join('\n');

const ERROR_PAGE = '<html><head><title>Errore | Bandi e Servizi</title></head></html>';

const now = new Date('2026-09-01T12:00:00Z');
const TERTIUM = 'RLP12026052483';

const ROLLING: SocrataRow = {
  codice_bando: 'RLO12026055023',
  titolo_bando: 'PR FESR 2021-2027 AZIONE 1.3.1 … SECONDO SPORTELLO',
  direzione_generale: 'SVILUPPO ECONOMICO',
  ente: 'Regione Lombardia',
  apertura_adesione: '2026-07-30T00:00:00.000',
  chiusura_adesione: null,
  tipo_strumento: 'Bando',
  presentato: '474',
};
const PAST: SocrataRow = {
  ...fx.socrata_row,
  codice_bando: 'RLL12017003328',
  chiusura_adesione: '2017-07-05T00:00:00.000',
  apertura_adesione: '2017-06-05T00:00:00.000',
};
const CONCORSO: SocrataRow = {
  ...fx.socrata_row,
  codice_bando: 'RLX12026099999',
  tipo_strumento: 'Concorsi Pubblici e Avvisi sul Personale',
};

interface StubOptions {
  rows?: unknown;
  socrataStatus?: number;
  socrataBody?: string;
  detail?: Record<string, string | (() => Promise<Response>)>;
  /** Sitemap body; default is an EMPTY urlset so every call keeps its bare URL. */
  sitemapXml?: string;
  sitemapStatus?: number;
}

function makeStub(o: StubOptions = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  // Sitemap requests are counted separately so the request-count assertions
  // below keep describing Socrata + detail traffic only.
  const sitemapRequests: string[] = [];
  const stub: FetchLike = async (url, init) => {
    if (url === LOMBARDIA_SITEMAP_URL) {
      sitemapRequests.push(url);
      if (o.sitemapStatus && o.sitemapStatus !== 200) return new Response('nope', { status: o.sitemapStatus });
      const xml = o.sitemapXml ?? '<?xml version="1.0" encoding="UTF-8"?><urlset></urlset>';
      return new Response(xml, { status: 200, headers: { 'content-type': 'application/xml' } });
    }
    calls.push({ url, init });
    if (url.startsWith(LOMBARDIA_SOCRATA_URL)) {
      if (o.socrataStatus && o.socrataStatus !== 200) {
        return new Response(o.socrataBody ?? 'Service Unavailable', { status: o.socrataStatus });
      }
      const body = o.socrataBody ?? JSON.stringify(o.rows ?? [fx.socrata_row, ROLLING, PAST, CONCORSO]);
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith(LOMBARDIA_DETAIL_URL_PREFIX)) {
      // Bare form: <prefix><CODICE>. Canonical form: <prefix><cat>/<sub>/<slug>-<CODICE>.
      const rest = url.slice(LOMBARDIA_DETAIL_URL_PREFIX.length);
      const codice = rest.includes('/') ? rest.slice(rest.lastIndexOf('-') + 1) : rest;
      const handler = o.detail?.[codice];
      if (typeof handler === 'function') return handler();
      if (typeof handler === 'string') {
        return new Response(handler, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      if (codice === TERTIUM && !o.detail) {
        return new Response(detailHtml, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response(ERROR_PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
    }
    throw new Error(`unexpected url ${url}`);
  };
  return { stub, calls, sitemapRequests };
}

const byId = (calls: NormalizedCall[], id: string) => calls.find((c) => c.source_identifier === id);

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

const warnedWith = (re: RegExp) =>
  warnSpy.mock.calls.some((args) => args.map(String).join(' ').match(re));

describe('buildSocrataUrl / lombardiaDetailUrl', () => {
  it('filters to open calls as of today and rolling calls opened within a year', () => {
    const url = buildSocrataUrl(now);
    expect(url.startsWith(`${LOMBARDIA_SOCRATA_URL}?$limit=1000&$order=chiusura_adesione&$where=`)).toBe(true);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain("apertura_adesione <= '2026-09-01T23:59:59'");
    expect(decoded).toContain("chiusura_adesione >= '2026-09-01T00:00:00'");
    expect(decoded).toContain("chiusura_adesione IS NULL AND apertura_adesione >= '2025-09-01T00:00:00'");
  });

  it('builds the deterministic bare-codice detail URL', () => {
    expect(lombardiaDetailUrl(TERTIUM)).toBe(
      'https://www.bandi.regione.lombardia.it/servizi/servizio/bandi/dettaglio/RLP12026052483',
    );
    expect(lombardiaDetailUrl(' RLP12026052483 ')).toBe(lombardiaDetailUrl(TERTIUM));
  });
});

describe('parseLombardiaDetail', () => {
  it('parses the fixture page: chip, hidden close date + hour, eligibility, funding source', () => {
    const d = parseLombardiaDetail(detailHtml);
    expect(d.not_found).toBe(false);
    expect(d.status).toBe('aperto');
    expect(d.deadline).toBe('2026-09-07');
    expect(d.deadline_time).toBe('12:00');
    expect(d.raw_snippet).toContain('checkCloseDate');
    expect(d.eligibility_text?.startsWith('possono presentare domanda di partecipazione le PMI')).toBe(true);
    expect(d.eligibility_text).toContain('Lombardia');
    expect(d.eligibility_text).not.toContain('&nbsp;');
    expect(d.eligibility_text).not.toContain('<');
    expect(d.funding_source).toBe('PR Lombardia FESR 2021-2027');
    expect(d.granting_body).toBeNull();
  });

  it('falls back to the "Scade il" line when the hidden input is absent', () => {
    const html = detailHtml.replace(/<input type="hidden" class="checkCloseDate"[^>]*>/, '');
    const d = parseLombardiaDetail(html);
    expect(d.deadline).toBe('2026-09-07');
    expect(d.deadline_time).toBe('12:00');
    expect(d.raw_snippet).toMatch(/Scade il: <strong data-entity="chiusura"> 07\/09\/2026 ,<\/strong> ore 12:00/);
  });

  it('detects the Errore page', () => {
    const d = parseLombardiaDetail(ERROR_PAGE);
    expect(d.not_found).toBe(true);
    expect(d.deadline).toBeNull();
    expect(d.status).toBe('unknown');
  });

  it('maps chip labels', () => {
    expect(parseLombardiaDetail(detailHtml.replace('bg-success-state', 'bg-danger-state').replace('Aperto', 'Chiuso')).status).toBe('chiuso');
    expect(parseLombardiaDetail(detailHtml.replace('bg-success-state', 'bg-warning-state').replace('Aperto', 'In apertura')).status).toBe('in_apertura');
    expect(parseLombardiaDetail(detailHtml.replace('Aperto', 'Boh')).status).toBe('unknown');
    expect(parseLombardiaDetail('<html><body>no chip</body></html>').status).toBe('unknown');
  });

  it('yields no deadline (loudly) when the hidden input and "Scade il" disagree', () => {
    const html = detailHtml.replace('value="2026-09-07 12:00"', 'value="2026-09-30 12:00"');
    const d = parseLombardiaDetail(html);
    expect(d.deadline).toBeNull();
    expect(d.deadline_time).toBeNull();
    expect(d.raw_snippet).toBeNull();
    expect(warnedWith(/\[grants\] lombardia detail: checkCloseDate and "Scade il" disagree/)).toBe(true);
  });

  it('ignores an impossible hidden date and uses the readable line instead', () => {
    const html = detailHtml.replace('value="2026-09-07 12:00"', 'value="2026-02-30 12:00"');
    const d = parseLombardiaDetail(html);
    expect(d.deadline).toBe('2026-09-07');
    expect(d.raw_snippet).toMatch(/Scade il/);
    expect(warnedWith(/impossible checkCloseDate/)).toBe(true);
  });

  it('returns null fields when nothing parseable is on the page', () => {
    const d = parseLombardiaDetail('<html><head><title>Bandi</title></head><body><p>Scade il: presto</p></body></html>');
    expect(d).toEqual({
      status: 'unknown',
      deadline: null,
      deadline_time: null,
      raw_snippet: null,
      eligibility_text: null,
      funding_source: null,
      granting_body: null,
      not_found: false,
    });
  });
});

describe('normalizeSocrataRow', () => {
  it('maps an open call from the typed Socrata fields', () => {
    const c = normalizeSocrataRow(fx.socrata_row, now);
    expect(c).toEqual({
      source: 'lombardia',
      source_identifier: TERTIUM,
      official_url: lombardiaDetailUrl(TERTIUM),
      title: 'Bando Tertium',
      granting_body: 'Regione Lombardia — TURISMO, MARKETING TERRITORIALE E MODA',
      deadline: '2026-09-07',
      deadline_time: null,
      status: 'open',
      eligibility_text: null,
      raw_snippet: '2026-09-07T00:00:00.000',
      parse_method: 'socrata_field',
    });
  });

  it('maps a NULL closing date to rolling', () => {
    const c = normalizeSocrataRow(ROLLING, now);
    expect(c?.status).toBe('rolling');
    expect(c?.deadline).toBeNull();
    expect(c?.raw_snippet).toBe('');
    expect(c?.parse_method).toBe('socrata_field');
    expect(c?.granting_body).toBe('Regione Lombardia — SVILUPPO ECONOMICO');
  });

  it('treats the deadline day itself as still open, the day after as closed', () => {
    expect(normalizeSocrataRow(fx.socrata_row, new Date('2026-09-07T23:00:00Z'))?.status).toBe('open');
    expect(normalizeSocrataRow(fx.socrata_row, new Date('2026-09-08T00:00:00Z'))).toBeNull();
  });

  it('drops past, excluded-instrument, not-yet-open and identifier-less rows', () => {
    expect(normalizeSocrataRow(PAST, now)).toBeNull();
    expect(normalizeSocrataRow(CONCORSO, now)).toBeNull();
    expect(normalizeSocrataRow({ ...fx.socrata_row, apertura_adesione: '2026-10-01T00:00:00.000' }, now)).toBeNull();
    expect(normalizeSocrataRow({ ...fx.socrata_row, codice_bando: '  ' }, now)).toBeNull();
  });

  it('never turns a garbage closing date into rolling or open — drops it loudly', () => {
    expect(normalizeSocrataRow({ ...fx.socrata_row, chiusura_adesione: 'fino a esaurimento' }, now)).toBeNull();
    expect(warnedWith(/\[grants\] lombardia: unparseable chiusura_adesione for RLP12026052483/)).toBe(true);
    expect(normalizeSocrataRow({ ...fx.socrata_row, chiusura_adesione: '2026-02-30T00:00:00.000' }, now)).toBeNull();
    expect(normalizeSocrataRow({ ...fx.socrata_row, apertura_adesione: 'n/a' }, now)).toBeNull();
    expect(warnedWith(/unparseable apertura_adesione/)).toBe(true);
  });

  it('defaults granting body to Regione Lombardia when ente is missing', () => {
    const c = normalizeSocrataRow({ ...fx.socrata_row, ente: '', direzione_generale: undefined }, now);
    expect(c?.granting_body).toBe('Regione Lombardia');
  });
});

describe('applyDetail', () => {
  const base = normalizeSocrataRow(fx.socrata_row, now) as NormalizedCall;

  it('lets the page win: hour, regex parse method, eligibility, funding source suffix', () => {
    const merged = applyDetail(base, parseLombardiaDetail(detailHtml), now);
    expect(merged).toMatchObject({
      status: 'open',
      deadline: '2026-09-07',
      deadline_time: '12:00',
      parse_method: 'regex',
      granting_body: 'Regione Lombardia — TURISMO, MARKETING TERRITORIALE E MODA (PR Lombardia FESR 2021-2027)',
    });
    expect(merged?.raw_snippet).toContain('checkCloseDate');
    expect(merged?.eligibility_text).toBeTruthy();
  });

  it('keeps the call unchanged on the Errore page', () => {
    expect(applyDetail(base, parseLombardiaDetail(ERROR_PAGE), now)).toBe(base);
    expect(warnedWith(/page not found for RLP12026052483/)).toBe(true);
  });

  it('drops a call whose chip says Chiuso', () => {
    const closed = parseLombardiaDetail(detailHtml.replace('bg-success-state', 'bg-danger-state').replace('Aperto', 'Chiuso'));
    expect(applyDetail(base, closed, now)).toBeNull();
    expect(warnedWith(/chip says Chiuso for RLP12026052483/)).toBe(true);
  });

  it('keeps the Socrata date when the page deadline is already past but the chip says open', () => {
    const stale = parseLombardiaDetail(
      detailHtml.replace('value="2026-09-07 12:00"', 'value="2026-08-20 12:00"').replace('07/09/2026', '20/08/2026'),
    );
    expect(stale.deadline).toBe('2026-08-20');
    const merged = applyDetail(base, stale, now);
    expect(merged).toMatchObject({
      deadline: '2026-09-07',
      deadline_time: null,
      parse_method: 'socrata_field',
      raw_snippet: '2026-09-07T00:00:00.000',
    });
    expect(merged?.eligibility_text).toBeTruthy(); // enrichment still applied
    expect(warnedWith(/page deadline already past/)).toBe(true);
  });

  it('keeps a rolling call rolling when the open page carries no deadline', () => {
    const rolling = normalizeSocrataRow(ROLLING, now) as NormalizedCall;
    const noDates = detailHtml.replace(/<input type="hidden" class="checkCloseDate"[^>]*>/, '').replace(/Scade il:[\s\S]*?<\/p>/, '');
    const merged = applyDetail(rolling, parseLombardiaDetail(noDates), now);
    expect(merged).toMatchObject({ status: 'rolling', deadline: null, parse_method: 'socrata_field', raw_snippet: '' });
    expect(merged?.eligibility_text).toBeTruthy();
  });

  it('promotes a rolling call to open when the page carries a future deadline', () => {
    const rolling = normalizeSocrataRow(ROLLING, now) as NormalizedCall;
    const merged = applyDetail(rolling, parseLombardiaDetail(detailHtml), now);
    expect(merged).toMatchObject({ status: 'open', deadline: '2026-09-07', deadline_time: '12:00', parse_method: 'regex' });
  });
});

describe('fetchLombardiaCalls', () => {
  it('normalizes Socrata rows and enriches only needsDetail identifiers', async () => {
    const { stub, calls: fetches } = makeStub();
    const calls = await fetchLombardiaCalls({ fetch: stub, now, needsDetail: async () => new Set([TERTIUM]) });
    expect(calls).toHaveLength(2);
    expect(byId(calls, TERTIUM)).toMatchObject({
      source: 'lombardia',
      source_identifier: TERTIUM,
      status: 'open',
      deadline: '2026-09-07',
      deadline_time: '12:00',
      parse_method: 'regex',
      official_url: 'https://www.bandi.regione.lombardia.it/servizi/servizio/bandi/dettaglio/RLP12026052483',
      granting_body: 'Regione Lombardia — TURISMO, MARKETING TERRITORIALE E MODA (PR Lombardia FESR 2021-2027)',
    });
    expect(byId(calls, TERTIUM)?.eligibility_text).toBeTruthy();
    expect(byId(calls, ROLLING.codice_bando)).toMatchObject({
      status: 'rolling',
      deadline: null,
      parse_method: 'socrata_field',
      raw_snippet: '',
      eligibility_text: null,
    });
    expect(byId(calls, PAST.codice_bando)).toBeUndefined();
    expect(byId(calls, CONCORSO.codice_bando)).toBeUndefined();
    expect(fetches).toHaveLength(2);
    expect(fetches[0].url.startsWith(LOMBARDIA_SOCRATA_URL)).toBe(true);
    expect(fetches[0].init?.headers).toMatchObject({ Accept: 'application/json' });
    expect(fetches[1].url).toBe(lombardiaDetailUrl(TERTIUM));
    expect(fetches[1].init?.headers).toMatchObject({ Accept: 'text/html' });
    expect(fetches[1].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('skips detail pages when resolveDetails is false', async () => {
    const { stub, calls: fetches } = makeStub();
    const calls = await fetchLombardiaCalls({ fetch: stub, now, resolveDetails: false });
    expect(byId(calls, TERTIUM)).toMatchObject({
      parse_method: 'socrata_field',
      raw_snippet: '2026-09-07T00:00:00.000',
      deadline_time: null,
      eligibility_text: null,
    });
    expect(fetches).toHaveLength(1);
  });

  it('throws on a Socrata non-2xx', async () => {
    const { stub } = makeStub({ socrataStatus: 503 });
    await expect(fetchLombardiaCalls({ fetch: stub, now })).rejects.toThrow(/\[grants\] lombardia socrata HTTP 503/);
  });

  it('throws on a malformed Socrata body (non-array JSON or non-JSON)', async () => {
    const obj = makeStub({ socrataBody: '{"error":true}' });
    await expect(fetchLombardiaCalls({ fetch: obj.stub, now })).rejects.toThrow(/malformed socrata payload/);
    const text = makeStub({ socrataBody: '<html>maintenance</html>' });
    await expect(fetchLombardiaCalls({ fetch: text.stub, now })).rejects.toThrow(/malformed socrata payload/);
  });

  it('returns an empty array (never throws) when Socrata legitimately lists nothing', async () => {
    const { stub } = makeStub({ rows: [] });
    await expect(fetchLombardiaCalls({ fetch: stub, now })).resolves.toEqual([]);
  });

  it('drops a call whose detail page says Chiuso', async () => {
    const closedHtml = detailHtml.replace('bg-success-state', 'bg-danger-state').replace('Aperto', 'Chiuso');
    const { stub } = makeStub({ detail: { [TERTIUM]: closedHtml } });
    const calls = await fetchLombardiaCalls({ fetch: stub, now, needsDetail: async () => new Set([TERTIUM]) });
    expect(byId(calls, TERTIUM)).toBeUndefined();
    expect(byId(calls, ROLLING.codice_bando)).toBeDefined();
  });

  it('keeps the Socrata call unchanged when the detail page is the Errore page', async () => {
    const { stub } = makeStub({ detail: { [TERTIUM]: ERROR_PAGE } });
    const calls = await fetchLombardiaCalls({ fetch: stub, now, needsDetail: async () => new Set([TERTIUM]) });
    expect(byId(calls, TERTIUM)).toMatchObject({ parse_method: 'socrata_field', deadline: '2026-09-07', deadline_time: null });
  });

  it('degrades to Socrata data with a warn when a detail fetch throws or is non-OK', async () => {
    const throwing = makeStub({
      detail: {
        [TERTIUM]: async () => {
          throw new Error('socket hang up');
        },
      },
    });
    const a = await fetchLombardiaCalls({ fetch: throwing.stub, now, needsDetail: async () => new Set([TERTIUM]) });
    expect(byId(a, TERTIUM)).toMatchObject({ parse_method: 'socrata_field', deadline: '2026-09-07', deadline_time: null, eligibility_text: null });
    expect(warnedWith(/\[grants\] lombardia detail failed: RLP12026052483 socket hang up/)).toBe(true);

    const failing = makeStub({ detail: { [TERTIUM]: async () => new Response('boom', { status: 500 }) } });
    const b = await fetchLombardiaCalls({ fetch: failing.stub, now, needsDetail: async () => new Set([TERTIUM]) });
    expect(byId(b, TERTIUM)).toMatchObject({ parse_method: 'socrata_field', deadline: '2026-09-07' });
    expect(warnedWith(/\[grants\] lombardia detail failed: RLP12026052483 HTTP 500/)).toBe(true);
  });

  it('bounds detail fetches by maxDetailFetches and visits rolling calls first', async () => {
    const { stub, calls: fetches } = makeStub();
    const calls = await fetchLombardiaCalls({ fetch: stub, now, maxDetailFetches: 1 }); // needsDetail default: all
    expect(fetches).toHaveLength(2);
    expect(fetches[1].url).toBe(lombardiaDetailUrl(ROLLING.codice_bando));
    expect(byId(calls, TERTIUM)?.parse_method).toBe('socrata_field'); // not reached this run
    expect(byId(calls, ROLLING.codice_bando)?.status).toBe('rolling'); // Errore page → unchanged
    expect(logSpy.mock.calls.some((args) => String(args[0]).match(/lombardia detail cap reached: 1 fetched, 1 left/))).toBe(true);
  });

  it('stops the detail loop when the wall-clock budget is exhausted', async () => {
    const { stub, calls: fetches } = makeStub();
    const calls = await fetchLombardiaCalls({ fetch: stub, now, detailBudgetMs: 0 });
    expect(fetches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(warnedWith(/detail budget exhausted after 0 page/)).toBe(true);
  });

  it('skips enrichment (loudly) when needsDetail itself throws', async () => {
    const { stub, calls: fetches } = makeStub();
    const calls = await fetchLombardiaCalls({
      fetch: stub,
      now,
      needsDetail: async () => {
        throw new Error('db down');
      },
    });
    expect(fetches).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(warnedWith(/\[grants\] lombardia needsDetail failed: db down/)).toBe(true);
  });

  it('dedupes Socrata rows by codice_bando (last wins)', async () => {
    const dup = { ...fx.socrata_row, titolo_bando: 'Bando Tertium (prorogato)', chiusura_adesione: '2026-09-30T00:00:00.000' };
    const { stub } = makeStub({ rows: [fx.socrata_row, dup] });
    const calls = await fetchLombardiaCalls({ fetch: stub, now, resolveDetails: false });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ title: 'Bando Tertium (prorogato)', deadline: '2026-09-30' });
  });

  it('exposes the connector contract', async () => {
    expect(lombardiaConnector.source).toBe('lombardia');
    const { stub } = makeStub();
    const { calls, complete } = await lombardiaConnector.fetchCalls({ fetch: stub, now, needsDetail: async () => new Set() });
    expect(complete).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.status !== ('closed' as string))).toBe(true);
  });

  it('reports the listing as INCOMPLETE (loudly) when Socrata fills the whole $limit page', async () => {
    // A full page may hide rows beyond the limit: the sync must not treat
    // absence from it as closure. The rows that were fetched still flow.
    const rows: SocrataRow[] = Array.from({ length: LOMBARDIA_SOCRATA_LIMIT }, (_, i) => ({
      ...fx.socrata_row,
      codice_bando: `RLP1${String(i).padStart(10, '0')}`,
    }));
    const { stub } = makeStub({ rows });
    const listing = await fetchLombardiaListing({ fetch: stub, now, resolveDetails: false });
    expect(listing.complete).toBe(false);
    expect(listing.calls).toHaveLength(LOMBARDIA_SOCRATA_LIMIT);
    expect(warnedWith(/\[grants\] lombardia truncated: socrata returned 1000 rows .*INCOMPLETE/)).toBe(true);

    const short = makeStub({ rows: rows.slice(0, 5) });
    const ok = await fetchLombardiaListing({ fetch: short.stub, now, resolveDetails: false });
    expect(ok.complete).toBe(true);
    expect(ok.calls).toHaveLength(5);
  });
});

describe('canonical official_url from the portal sitemap', () => {
  const CANON = `${LOMBARDIA_DETAIL_URL_PREFIX}attivita-produttive-imprese/imprese-commerciali/bando-tertium-${TERTIUM}`;
  const CATALOGO = CANON.replace('/bandi/dettaglio/', '/catalogo/dettaglio/');
  const PROV = `${LOMBARDIA_DETAIL_URL_PREFIX}istruzione-formazione-lavoro/lavoro-occupazione/dote-impresa-sondrio-PR_SO_42025049612`;
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://www.bandi.regione.lombardia.it/servizi/home</loc></url>
    <url><loc>${CATALOGO}</loc></url>
    <url><loc>${CANON}</loc></url>
    <url><loc>${PROV}</loc></url>
    <url><loc>https://www.bandi.regione.lombardia.it/servizi/servizio/comunicazioni/dettaglio/x/y/news-item-ABC123456789</loc></url>
  </urlset>`;

  it('parses detail locs by trailing codice, prefers /bandi/ over /catalogo/, handles PR_ codes', () => {
    const map = parseSitemapCanonicalUrls(xml);
    expect(map.get(TERTIUM)).toBe(CANON);
    expect(map.get('PR_SO_42025049612')).toBe(PROV);
    // comunicazioni entries are detail pages of another kind — captured but harmless (never a bando codice)
    expect(map.has('nonexistent')).toBe(false);
  });

  it('uses the canonical URL when the sitemap has the codice, bare-codice otherwise', async () => {
    const { stub } = makeStub({ sitemapXml: xml });
    const now = new Date('2026-09-01T10:00:00Z');
    const calls = await fetchLombardiaCalls({ fetch: stub, now, resolveDetails: false });
    expect(byId(calls, TERTIUM)?.official_url).toBe(CANON);
    const other = calls.find((c) => c.source_identifier !== TERTIUM);
    expect(other?.official_url).toBe(lombardiaDetailUrl(other!.source_identifier));
  });

  it('degrades to bare-codice URLs (and never throws) when the sitemap fails', async () => {
    const { stub } = makeStub({ sitemapStatus: 503 });
    const now = new Date('2026-09-01T10:00:00Z');
    const calls = await fetchLombardiaCalls({ fetch: stub, now, resolveDetails: false });
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.official_url).toBe(lombardiaDetailUrl(c.source_identifier));
  });

  it('fetches the detail page at the canonical URL, not the bare one', async () => {
    const { stub, calls: seen } = makeStub({ sitemapXml: xml });
    const now = new Date('2026-09-01T10:00:00Z');
    await fetchLombardiaCalls({ fetch: stub, now, needsDetail: async () => new Set([TERTIUM]) });
    expect(seen.some((c) => c.url === CANON)).toBe(true);
    expect(seen.some((c) => c.url === lombardiaDetailUrl(TERTIUM))).toBe(false);
  });

  it('can be switched off', async () => {
    const { stub, sitemapRequests } = makeStub({ sitemapXml: xml });
    const now = new Date('2026-09-01T10:00:00Z');
    const calls = await fetchLombardiaCalls({ fetch: stub, now, resolveDetails: false, resolveCanonicalUrls: false });
    expect(byId(calls, TERTIUM)?.official_url).toBe(lombardiaDetailUrl(TERTIUM));
    expect(sitemapRequests).toHaveLength(0);
  });
});
