import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INCENTIVI_SOLR_URL,
  buildIncentiviUrl,
  normalizeIncentiviDoc,
  extractEligibility,
  dedupeByOfficialLink,
  fetchIncentiviCalls,
  fetchIncentiviListing,
  incentiviConnector,
  type IncentiviDoc,
} from './incentivi';

// Real records cut from the live Solr payload on 2026-09-02 (see __fixtures__).
const fx = JSON.parse(readFileSync(join(process.cwd(), 'src/lib/grants/__fixtures__/incentivi-sample.json'), 'utf-8'));
const now = new Date('2026-09-02T10:00:00Z');
const raw = (d: Record<string, unknown>): IncentiviDoc => ({
  nid: d.zs_nid as string, title: d.zs_title as string, url: d.zs_url as string, link: d.zs_field_link as string,
  close: d.zs_field_close_date as string | null, open: d.zs_field_open_date as string | null,
  desc: d.zs_field_close_date_descriptor as string | null, multi: d.zs_field_multibando as string | null,
  grant: d.zs_field_subject_grant as string | null, regions: d.zm_field_regions_value as string[] | null,
  subjects: d.zm_field_subject_type_value as string[] | null, scopes: d.zm_field_scopes_value as string[] | null,
  forms: d.zm_field_support_form_value as string[] | null, ateco: d.zs_field_ateco as string | null,
  upd: d.ds_last_update as string | null, body: d.zs_body as string | null,
});

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
function makeStub(o: { status?: number; body?: string; docs?: IncentiviDoc[]; numFound?: number } = {}) {
  const calls: string[] = [];
  const stub: FetchLike = async (url) => {
    calls.push(url);
    if (o.status && o.status !== 200) return new Response('nope', { status: o.status });
    if (o.body !== undefined) return new Response(o.body, { status: 200 });
    const docs = o.docs ?? [];
    return new Response(JSON.stringify({ response: { numFound: o.numFound ?? docs.length, docs } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { stub, calls };
}

describe('normalizeIncentiviDoc — open-ness from typed dates in code, never from text', () => {
  it('maps an open regional call with a specific deadline', () => {
    const c = normalizeIncentiviDoc(raw(fx.specific), now)!;
    expect(c.source).toBe('incentivi');
    expect(c.status).toBe('open');
    expect(c.deadline).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.deadline! >= '2026-09-02').toBe(true);
    expect(c.parse_method).toBe('iso_field');
    expect(c.raw_snippet).toBe(fx.specific.zs_field_close_date);
    expect(c.official_url).toMatch(/^https?:\/\//);
    expect(c.catalog_url).toMatch(/^https:\/\/www\.incentivi\.gov\.it\/it\/catalogo\//);
    expect(c.regions).toEqual(fx.specific.zm_field_regions_value);
    expect(c.facets?.national).toBe(false);
    expect(c.page_status).toBe('n/a');
  });
  it('treats no close date as rolling (no deadline)', () => {
    const c = normalizeIncentiviDoc(raw(fx.rolling_no_date), now)!;
    expect(c.status).toBe('rolling');
    expect(c.deadline).toBeNull();
  });
  it('treats a far-future formal close + sportello descriptor as rolling, keeping the formal date', () => {
    const c = normalizeIncentiviDoc(raw(fx.far_future_sportello), now)!;
    expect(c.status).toBe('rolling');
    expect(c.deadline).toMatch(/^20(29|3\d)-/);
    expect(c.source_note).toMatch(/sportello/i);
  });
  it('marks a record tagged with (almost) every region as national', () => {
    const c = normalizeIncentiviDoc(raw(fx.national), now)!;
    expect(c.facets?.national).toBe(true);
    expect((c.regions ?? []).length).toBeGreaterThanOrEqual(15);
  });
  it('drops closed and not-yet-open records', () => {
    expect(normalizeIncentiviDoc(raw(fx.past), now)).toBeNull();
    if (fx.upcoming) expect(normalizeIncentiviDoc(raw(fx.upcoming), now)).toBeNull();
  });
  it('never turns a garbage close date into open or rolling — drops it', () => {
    expect(normalizeIncentiviDoc({ ...raw(fx.specific), close: 'entro fine anno' }, now)).toBeNull();
  });
  it('drops records without an official link or title', () => {
    expect(normalizeIncentiviDoc({ ...raw(fx.specific), link: '' }, now)).toBeNull();
    expect(normalizeIncentiviDoc({ ...raw(fx.specific), title: '' }, now)).toBeNull();
  });
  it('keeps plain http official links (third-party pages) but never a URL shortener', () => {
    const http = normalizeIncentiviDoc({ ...raw(fx.specific), link: 'http://www.provincia.tn.it/' }, now)!;
    expect(http.official_url).toBe('http://www.provincia.tn.it/');
    const short = normalizeIncentiviDoc({ ...raw(fx.specific), link: 'http://tinyurl.com/4rnmd7yh' }, now)!;
    expect(short.official_url).toBe(short.catalog_url);
    expect(short.official_url).toMatch(/^https:\/\/www\.incentivi\.gov\.it\//);
    expect(normalizeIncentiviDoc({ ...raw(fx.specific), link: 'http://tinyurl.com/x', url: '' }, now)).toBeNull();
  });
  it('never parses a deadline out of the free-text descriptor', () => {
    const c = normalizeIncentiviDoc({ ...raw(fx.rolling_no_date), desc: 'Domande entro il 31/10/2025' }, now)!;
    expect(c.deadline).toBeNull();
    expect(c.source_note).toContain('31/10/2025');
  });
});

describe('extractEligibility', () => {
  it('slices the "A chi si rivolge" section up to "Cosa prevede" from the body HTML', () => {
    const e = extractEligibility(fx.specific.zs_body);
    expect(e).toBeTruthy();
    expect(e).not.toMatch(/A chi si rivolge/);
    expect(e).not.toMatch(/Cosa prevede/);
    expect(e).not.toMatch(/<[a-z]+>/);
  });
  it('returns null when the heading is absent', () => {
    expect(extractEligibility('<p>Solo testo</p>')).toBeNull();
    expect(extractEligibility(null)).toBeNull();
  });
});

describe('dedupeByOfficialLink', () => {
  it('collapses records sharing an official link, keeping the most recently updated', () => {
    const [a, b] = fx.duplicate_pair.map((d: Record<string, unknown>) => normalizeIncentiviDoc(raw(d), now)!);
    expect(a.official_url).toBe(b.official_url);
    const out = dedupeByOfficialLink([{ ...a, _upd: '2026-01-01T00:00:00Z' }, { ...b, _upd: '2026-06-01T00:00:00Z' }]);
    expect(out).toHaveLength(1);
    expect(out[0].source_identifier).toBe(b.source_identifier);
    expect('_upd' in out[0]).toBe(false);
  });
});

describe('fetchIncentiviListing', () => {
  it('requests the Solr index with the aliased field list and reports completeness', async () => {
    const docs = [raw(fx.specific), raw(fx.rolling_no_date), raw(fx.past)];
    const { stub, calls } = makeStub({ docs });
    const r = await fetchIncentiviListing({ fetch: stub, now });
    expect(calls[0].startsWith(INCENTIVI_SOLR_URL)).toBe(true);
    expect(calls[0]).toContain('rows=8000');
    expect(calls[0]).toContain('index_id');
    expect(r.complete).toBe(true);
    expect(r.calls.map((c) => c.source_identifier).sort()).toEqual([String(fx.specific.zs_nid), String(fx.rolling_no_date.zs_nid)].sort());
  });
  it('flags an incomplete listing when numFound exceeds the rows returned', async () => {
    const { stub } = makeStub({ docs: [raw(fx.specific)], numFound: 9999 });
    const r = await fetchIncentiviListing({ fetch: stub, now });
    expect(r.complete).toBe(false);
    expect(r.calls).toHaveLength(1);
  });
  it('throws loudly on HTTP errors and malformed payloads (never returns [])', async () => {
    await expect(fetchIncentiviCalls({ fetch: makeStub({ status: 503 }).stub, now })).rejects.toThrow(/incentivi solr HTTP 503/);
    await expect(fetchIncentiviCalls({ fetch: makeStub({ body: 'not json' }).stub, now })).rejects.toThrow(/malformed/);
    await expect(fetchIncentiviCalls({ fetch: makeStub({ body: '{"response":{}}' }).stub, now })).rejects.toThrow(/no docs/);
  });
  it('exposes the connector contract', () => {
    expect(incentiviConnector.source).toBe('incentivi');
    expect(buildIncentiviUrl(10)).toContain('rows=10');
  });
});
