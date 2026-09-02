import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fetchSediaCalls,
  fetchSediaListing,
  normalizeSediaResult,
  buildSediaMultipart,
  SEDIA_STATUS_OPEN,
  SEDIA_SEARCH_URL,
  sediaConnector,
  type SediaResult,
} from './sedia';
import type { FetchLike } from '../types';

interface FixtureRecord {
  url: string;
  metadata: Record<string, string[]>;
}
interface Fixture {
  _meta: Record<string, unknown>;
  open: FixtureRecord;
  closed: FixtureRecord;
}

const fx = JSON.parse(
  readFileSync(join(process.cwd(), 'src/lib/grants/__fixtures__/sedia-sample.json'), 'utf-8'),
) as Fixture;

const now = new Date('2026-09-01T12:00:00Z');

type RecordedCall = { url: string; init: RequestInit };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeStub(results: SediaResult[], totalResults = results.length) {
  const calls: RecordedCall[] = [];
  const fetchStub: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    return jsonResponse({
      apiVersion: '2.154',
      totalResults,
      pageNumber: 1,
      pageSize: 100,
      results,
    });
  };
  return { calls, fetchStub };
}

function cloneWith(record: FixtureRecord, patch: Record<string, string[]>): SediaResult {
  return { metadata: { ...record.metadata, ...patch } };
}

function pageNumberOf(url: string): number {
  const m = url.match(/pageNumber=(\d+)/);
  return m ? Number(m[1]) : NaN;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSediaCalls — fixture end-to-end', () => {
  it('emits exactly the open record, normalised from the typed deadlineDate field', async () => {
    const { fetchStub } = makeStub([fx.open, fx.closed], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.source).toBe('sedia');
    expect(call.source_identifier).toBe('HORIZON-JU-IHI-2026-13-two-stage-01');
    expect(call.official_url).toBe(
      'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/horizon-ju-ihi-2026-13-two-stage-01',
    );
    expect(call.deadline).toBe('2027-04-21');
    expect(call.raw_snippet).toBe('2027-04-21T00:00:00.000+0000');
    expect(call.parse_method).toBe('iso_field');
    expect(call.status).toBe('open');
    expect(call.deadline_time).toBeNull();
    expect(call.granting_body).toBe('Horizon Europe (HORIZON)');
    expect(call.title).toBe('IHI European HealthCare Incubator Network');
    expect(call.eligibility_text).toBeTruthy();
    expect(call.eligibility_text).not.toContain('<');
  });

  it('drops the source-Closed record even though its max deadline (2026-10-20) is in the future', async () => {
    const { fetchStub } = makeStub([fx.open, fx.closed], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(fx.closed.metadata.status).toEqual(['31094503']);
    expect(calls.map((c) => c.source_identifier)).not.toContain('HORIZON-CL5-2026-04-Two-Stage-D3-02');
  });

  it('never trusts the status code: an Open-labelled row with a past deadline is NOT emitted', async () => {
    // Live finding 2026-09-01: status 31094502 returns closed 2023-dated rows.
    const stale = cloneWith(fx.open, {
      identifier: ['HORIZON-STALE-2023-01'],
      status: [SEDIA_STATUS_OPEN],
      deadlineDate: ['2023-03-15T00:00:00.000+0000'],
    });
    const { fetchStub } = makeStub([fx.open, stale], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(calls.map((c) => c.source_identifier)).toEqual(['HORIZON-JU-IHI-2026-13-two-stage-01']);
  });

  it('a deadline equal to today is still open (unknown hour — the daily expiry closes it tomorrow); yesterday is not', () => {
    // Same rule as Lombardia (isTodayOrFuture): a deadline-day row must not be
    // dropped from the listing, or the sync would count a still-open call as
    // missing while founders can still apply until the Brussels cut-off.
    const today = cloneWith(fx.open, { deadlineDate: ['2026-09-01T17:00:00.000+0000'] });
    expect(normalizeSediaResult(today, now)?.deadline).toBe('2026-09-01');
    const yesterday = cloneWith(fx.open, { deadlineDate: ['2026-08-31T17:00:00.000+0000'] });
    expect(normalizeSediaResult(yesterday, now)).toBeNull();
    const tomorrow = cloneWith(fx.open, { deadlineDate: ['2026-09-02T00:00:00.000+0000'] });
    expect(normalizeSediaResult(tomorrow, now)?.deadline).toBe('2026-09-02');
  });

  it('exposes the connector object for the sync and reports a complete listing', async () => {
    expect(sediaConnector.source).toBe('sedia');
    const { fetchStub } = makeStub([fx.open, fx.closed], 2);
    const listing = await sediaConnector.fetchCalls({ fetch: fetchStub, now });
    expect(listing.complete).toBe(true);
    expect(listing.calls).toHaveLength(1);
  });
});

describe('fetchSediaCalls — request shape', () => {
  it('POSTs a hand-built multipart whose parts each carry Content-Type: application/json', async () => {
    const { calls: recorded, fetchStub } = makeStub([fx.open, fx.closed], 2);
    await fetchSediaCalls({ fetch: fetchStub, now });

    expect(recorded).toHaveLength(1);
    const { url, init } = recorded[0];
    expect(url.startsWith(SEDIA_SEARCH_URL)).toBe(true);
    expect(url).toContain('apiKey=SEDIA');
    expect(url).toContain('text=***');
    expect(url).toContain('pageSize=100');
    expect(url).toContain('pageNumber=1');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(String(headers['Content-Type'])).toMatch(/^multipart\/form-data; boundary=/);
    expect(String(headers.Accept)).toBe('application/json');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = String(init.body);
    // Every part must declare application/json — the API returns 500 otherwise.
    expect(body).toMatch(/name="query"\r\nContent-Type: application\/json\r\n\r\n\{"bool"/);
    expect(body).toMatch(/name="languages"\r\nContent-Type: application\/json\r\n\r\n\["en"\]/);
    expect(body).toMatch(/name="sort"\r\nContent-Type: application\/json\r\n\r\n\{"field":"identifier","order":"ASC"\}/);
    // No displayFields part: live-verified 2026-09-01 that sending one makes
    // the API drop topicConditions (the only eligibility source) from every row.
    expect(body).not.toMatch(/name="displayFields"/);
    const partCount = body.split('Content-Disposition: form-data;').length - 1;
    const jsonTypeCount = body.split('Content-Type: application/json').length - 1;
    expect(partCount).toBe(3);
    expect(jsonTypeCount).toBe(3);

    expect(body).toContain('"status":["31094502"]');
    expect(body).toContain('"type":["1"]');
    expect(body).toContain('"gte":"2026-09-01T00:00:00.000+0000"');

    const boundary = String(headers['Content-Type']).replace('multipart/form-data; boundary=', '');
    expect(body.startsWith(`--${boundary}\r\n`)).toBe(true);
    expect(body.endsWith(`--${boundary}--\r\n`)).toBe(true);
  });

  it('buildSediaMultipart uses a fresh boundary each time and the boundary matches the header', () => {
    const a = buildSediaMultipart(now);
    const b = buildSediaMultipart(now);
    expect(a.contentType).not.toBe(b.contentType);
    const boundary = a.contentType.replace('multipart/form-data; boundary=', '');
    expect(a.body).toContain(`--${boundary}\r\n`);
  });
});

describe('normalizeSediaResult — guards', () => {
  it('returns null when the max deadline has passed', () => {
    expect(normalizeSediaResult(fx.open, new Date('2027-05-01T00:00:00Z'))).toBeNull();
  });

  it('returns null and warns when deadlineDate is missing (no rolling concept on SEDIA)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const noDeadline = cloneWith(fx.open, { deadlineDate: [] });
    expect(normalizeSediaResult(noDeadline, now)).toBeNull();
    const { deadlineDate: _omit, ...rest } = fx.open.metadata;
    void _omit;
    expect(normalizeSediaResult({ metadata: rest }, now)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[grants] sedia: no deadlineDate for', 'HORIZON-JU-IHI-2026-13-two-stage-01');
  });

  it('returns null and warns when deadlineDate is present but unparseable — never guesses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bad = cloneWith(fx.open, { deadlineDate: ['31/12/2027', 'soon'] });
    expect(normalizeSediaResult(bad, now)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/^\[grants\] sedia: unparseable deadlineDate/);
  });

  it('returns null for non-topic type, non-Open status or missing identifier', () => {
    expect(normalizeSediaResult(cloneWith(fx.open, { type: ['2'] }), now)).toBeNull();
    expect(normalizeSediaResult(cloneWith(fx.open, { status: ['31094501'] }), now)).toBeNull();
    expect(normalizeSediaResult(cloneWith(fx.open, { identifier: [] }), now)).toBeNull();
    expect(normalizeSediaResult({}, now)).toBeNull();
  });

  it('picks the LAST cut-off of a multi-deadline row and keeps the exact raw string as raw_snippet', () => {
    const multi = cloneWith(fx.open, {
      deadlineDate: ['2027-01-15T17:00:00.000+0000', '2026-11-30T00:00:00.000+0000', '2026-10-01T00:00:00.000+0000'],
    });
    const call = normalizeSediaResult(multi, now);
    expect(call?.deadline).toBe('2027-01-15');
    expect(call?.raw_snippet).toBe('2027-01-15T17:00:00.000+0000');
    expect(call?.deadline_time).toBeNull();
  });

  it('falls back on granting_body deterministically', () => {
    const withAction = cloneWith(fx.open, { frameworkProgramme: ['999'], typesOfAction: ['HORIZON-RIA'] });
    expect(normalizeSediaResult(withAction, now)?.granting_body).toBe('EU — HORIZON-RIA');
    const bare = cloneWith(fx.open, { frameworkProgramme: [], typesOfAction: [] });
    expect(normalizeSediaResult(bare, now)?.granting_body).toBe('European Commission');
  });

  it('falls back to callTitle then identifier for the title and null eligibility without topicConditions', () => {
    const noTitle = cloneWith(fx.open, { title: [], topicConditions: [] });
    const call = normalizeSediaResult(noTitle, now);
    expect(call?.title).toBe('Innovative Health Initiative JU Call 13');
    expect(call?.eligibility_text).toBeNull();
    const nothing = cloneWith(fx.open, { title: [], callTitle: [] });
    expect(normalizeSediaResult(nothing, now)?.title).toBe('HORIZON-JU-IHI-2026-13-two-stage-01');
  });
});

describe('fetchSediaCalls — failures are loud', () => {
  it('throws on HTTP 500 (never returns [])', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub: FetchLike = async () =>
      new Response('{"type":"throwable","message":"An internal error occurred"}', { status: 500 });
    await expect(fetchSediaCalls({ fetch: fetchStub, now })).rejects.toThrow(/\[grants\] sedia HTTP 500/);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toMatch(/\[grants\] sedia HTTP 500 on page 1: .*internal error/);
  });

  it('throws on a 2xx body without results[]', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub: FetchLike = async () => jsonResponse({ apiVersion: '2.154', totalResults: 0 });
    await expect(fetchSediaCalls({ fetch: fetchStub, now })).rejects.toThrow(/malformed envelope \(no results\[\]\)/);
  });

  it('throws on a 2xx body that is not JSON', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchStub: FetchLike = async () => new Response('<html>maintenance</html>', { status: 200 });
    await expect(fetchSediaCalls({ fetch: fetchStub, now })).rejects.toThrow(/\[grants\] sedia: malformed JSON/);
  });

  it('propagates a network error from fetch', async () => {
    const fetchStub: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    await expect(fetchSediaCalls({ fetch: fetchStub, now })).rejects.toThrow('ECONNRESET');
  });

  it('returns [] (not a throw) for a well-formed empty envelope — the sync owns the zero-rows alarm', async () => {
    const { calls: recorded, fetchStub } = makeStub([], 0);
    await expect(fetchSediaCalls({ fetch: fetchStub, now })).resolves.toEqual([]);
    expect(recorded).toHaveLength(1);
  });
});

describe('fetchSediaCalls — pagination', () => {
  function synthetic(i: number): SediaResult {
    return cloneWith(fx.open, { identifier: [`X-${String(i).padStart(3, '0')}`] });
  }
  function pagedStub(pages: Record<number, SediaResult[]>, totalResults: number) {
    const recorded: RecordedCall[] = [];
    const fetchStub: FetchLike = async (url, init) => {
      recorded.push({ url, init: init ?? {} });
      const page = pageNumberOf(url);
      return jsonResponse({
        apiVersion: '2.154',
        totalResults,
        pageNumber: page,
        pageSize: 100,
        results: pages[page] ?? [],
      });
    };
    return { recorded, fetchStub };
  }

  it('walks pages until totalResults is covered', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => synthetic(i));
    const page2 = Array.from({ length: 50 }, (_, i) => synthetic(100 + i));
    const { recorded, fetchStub } = pagedStub({ 1: page1, 2: page2 }, 150);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => pageNumberOf(r.url))).toEqual([1, 2]);
    expect(calls).toHaveLength(150);
    expect(new Set(calls.map((c) => c.source_identifier)).size).toBe(150);
  });

  it('respects maxPages, warns loudly about truncation and reports the listing as INCOMPLETE', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page1 = Array.from({ length: 100 }, (_, i) => synthetic(i));
    const page2 = Array.from({ length: 50 }, (_, i) => synthetic(100 + i));
    const { recorded, fetchStub } = pagedStub({ 1: page1, 2: page2 }, 150);
    const listing = await fetchSediaListing({ fetch: fetchStub, now, maxPages: 1 });
    expect(recorded).toHaveLength(1);
    expect(listing.calls).toHaveLength(100);
    // The calls beyond the cap were never fetched: the sync must not treat
    // their absence as closure (that would close them after two runs).
    expect(listing.complete).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/sedia truncated/);
    expect(String(warn.mock.calls[0][0])).toContain('totalResults=150');
    expect(String(warn.mock.calls[0][0])).toMatch(/INCOMPLETE/);
  });

  it('reports INCOMPLETE when totalResults is unknown and every page up to the cap was full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const recorded: RecordedCall[] = [];
    const fetchStub: FetchLike = async (url, init) => {
      recorded.push({ url, init: init ?? {} });
      const page = pageNumberOf(url);
      return jsonResponse({ apiVersion: '2.154', results: Array.from({ length: 100 }, (_, i) => synthetic(page * 1000 + i)) });
    };
    const listing = await fetchSediaListing({ fetch: fetchStub, now, maxPages: 2 });
    expect(recorded).toHaveLength(2);
    expect(listing.calls).toHaveLength(200);
    expect(listing.complete).toBe(false);
    expect(warn.mock.calls.some((c) => /sedia truncated: totalResults unknown/.test(String(c[0])))).toBe(true);
  });

  it('reports a listing that ends exactly at the cap as complete', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => synthetic(i));
    const { fetchStub } = pagedStub({ 1: page1 }, 100);
    const listing = await fetchSediaListing({ fetch: fetchStub, now, maxPages: 1 });
    expect(listing.complete).toBe(true);
    expect(listing.calls).toHaveLength(100);
  });

  it('stops on an empty page even when totalResults claims more', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => synthetic(i));
    const { recorded, fetchStub } = pagedStub({ 1: page1 }, 500);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(recorded).toHaveLength(2);
    expect(calls).toHaveLength(100);
  });

  it('honours a custom pageSize in the URL and the stop rule', async () => {
    const page1 = Array.from({ length: 10 }, (_, i) => synthetic(i));
    const { recorded, fetchStub } = pagedStub({ 1: page1 }, 10);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now, pageSize: 10 });
    expect(recorded).toHaveLength(1);
    expect(recorded[0].url).toContain('pageSize=10');
    expect(calls).toHaveLength(10);
  });
});

describe('fetchSediaCalls — dedupe by identifier', () => {
  const stale = cloneWith(fx.open, {
    DATASOURCE: ['SEDIA_PRD_CENTRICITY'],
    deadlineDate: ['2023-04-20T00:00:00.000+0000'],
  });
  const fresh = cloneWith(fx.open, {
    DATASOURCE: ['SEDIA'],
    deadlineDate: ['2027-04-21T00:00:00.000+0000'],
  });

  it('prefers the DATASOURCE=SEDIA row over the stale CENTRICITY duplicate (stale first)', async () => {
    const { fetchStub } = makeStub([stale, fresh], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(calls).toHaveLength(1);
    expect(calls[0].deadline).toMatch(/^2027-/);
  });

  it('prefers the DATASOURCE=SEDIA row over the stale CENTRICITY duplicate (fresh first)', async () => {
    const { fetchStub } = makeStub([fresh, stale], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(calls).toHaveLength(1);
    expect(calls[0].deadline).toMatch(/^2027-/);
  });

  it('within the same DATASOURCE prefers the row that has both status and deadlineDate', async () => {
    const incomplete = cloneWith(fx.open, { DATASOURCE: ['SEDIA'], deadlineDate: [] });
    const { fetchStub } = makeStub([incomplete, fresh], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(calls).toHaveLength(1);
    expect(calls[0].deadline).toBe('2027-04-21');
  });

  it('keeps the first of two complete same-source rows and warns when their deadlines disagree', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const other = cloneWith(fx.open, { DATASOURCE: ['SEDIA'], deadlineDate: ['2027-06-30T00:00:00.000+0000'] });
    const { fetchStub } = makeStub([fresh, other], 2);
    const calls = await fetchSediaCalls({ fetch: fetchStub, now });
    expect(calls).toHaveLength(1);
    expect(calls[0].deadline).toBe('2027-04-21');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/conflicting deadlineDate/);
  });
});
