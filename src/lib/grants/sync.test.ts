import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ConnectorOptions, NormalizedCall, SourceConnector } from './types';

/**
 * Grants sync — the rules that keep a wrong date from reaching a founder.
 * Every DB call is mocked and routed by SQL text; the connectors are injected
 * (the fake below) so none of this depends on SEDIA / Lombardia code.
 */

const { getMock, runMock, queryMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
  queryMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: queryMock }));
// The real connectors are separate work packages; the sync only needs them
// for its DEFAULT source list, which every test below overrides.
vi.mock('./sources/sedia', () => ({ sediaConnector: { source: 'sedia', fetchCalls: async () => [] } }));
vi.mock('./sources/lombardia', () => ({ lombardiaConnector: { source: 'lombardia', fetchCalls: async () => [] } }));
// Legacy parser side-effects (the deadline-gate test below imports the parser).
vi.mock('@/lib/pending-actions', () => ({ createPendingAction: vi.fn(async () => ({ id: 'pa_x' })) }));
vi.mock('@/lib/competitor-profiles', () => ({ updateCompetitorProfile: vi.fn(async () => undefined) }));
vi.mock('@/lib/signal-autoflow', () => ({ isAutoflowEnabled: () => false, routeAlertAutoflow: vi.fn(async () => 'inbox') }));
vi.mock('@/lib/signal-activity-log', () => ({ logSignalActivity: vi.fn(async () => undefined) }));

import { syncFundingCalls, buildGrantAlertContent, expireFundingCalls, KEEP_PAGE_PARSE_SQL, KEEP_PAGE_STATUS_SQL } from '@/lib/grants/sync';
import { persistEcosystemAlerts } from '@/lib/ecosystem-alert-parser';

const now = new Date('2026-09-01T12:00:00Z');
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

const IHI: NormalizedCall = {
  source: 'sedia',
  source_identifier: 'HORIZON-JU-IHI-2026-13-two-stage-01',
  official_url:
    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/horizon-ju-ihi-2026-13-two-stage-01',
  title: 'IHI European HealthCare Incubator Network',
  granting_body: 'Horizon Europe (HORIZON)',
  deadline: '2027-04-21',
  deadline_time: null,
  status: 'open',
  eligibility_text: 'Consortia of at least three legal entities from three different Member States.',
  raw_snippet: '2027-04-21T00:00:00.000+0000',
  parse_method: 'iso_field',
};

const WATCHER_IT = { project_id: 'proj_it', monitor_id: 'mon_it', locale: 'it' };

type Call = [string, ...unknown[]];
const sqlOf = (c: Call) => c[0];
const callsMatching = (mock: { mock: { calls: unknown[][] } }, re: RegExp) =>
  (mock.mock.calls as Call[]).filter((c) => re.test(sqlOf(c)));

/**
 * A connector stub. `complete` mirrors ConnectorResult.complete — false means
 * the listing was truncated and the sync must not close anything.
 */
function fakeConnector(
  calls: NormalizedCall[] | ((o: ConnectorOptions) => Promise<NormalizedCall[]>),
  complete = true,
): SourceConnector & { fetchCalls: ReturnType<typeof vi.fn> } {
  const produce = typeof calls === 'function' ? calls : async () => calls;
  const fetchCalls = vi.fn(async (o: ConnectorOptions) => ({ calls: await produce(o), complete }));
  return { source: 'sedia', fetchCalls };
}

/** Shape of the upsert's RETURNING row (new values + the row as it was before). */
interface UpsertRow {
  id: string;
  inserted: boolean;
  status: 'open' | 'rolling' | 'closed';
  deadline: string | null;
  deadline_time: string | null;
  prev_status: string | null;
  prev_deadline: string | null;
  prev_deadline_time: string | null;
}
const upsertRow = (o: Partial<UpsertRow> = {}): UpsertRow => ({
  id: 'fcall_x',
  inserted: true,
  status: 'open',
  deadline: '2027-04-21',
  deadline_time: null,
  prev_status: null,
  prev_deadline: null,
  prev_deadline_time: null,
  ...o,
});
/** A known, unchanged row: not inserted, previous values equal to the new ones. */
const UNCHANGED = upsertRow({ inserted: false, prev_status: 'open', prev_deadline: '2027-04-21', prev_deadline_time: null });

interface RouteOptions {
  watchers?: unknown[];
  upsert?: UpsertRow[];
}

function routeQueries(opts: RouteOptions = {}) {
  queryMock.mockImplementation(async (sql: string) => {
    if (/FROM monitors m/.test(sql)) return opts.watchers ?? [WATCHER_IT];
    if (/INSERT INTO funding_calls/.test(sql)) return opts.upsert ?? [upsertRow()];
    if (/INSERT INTO ecosystem_alerts/.test(sql)) return [{ id: 'ealr_x' }];
    if (/SELECT source_identifier FROM funding_calls/.test(sql)) return [];
    if (/FROM pending_actions/.test(sql)) return [];
    return [];
  });
}

beforeEach(() => {
  getMock.mockReset();
  runMock.mockReset();
  queryMock.mockReset();
  runMock.mockResolvedValue({ count: 0 });
  getMock.mockResolvedValue({ ran_today: false });
  routeQueries();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('syncFundingCalls — rule 2: a NEW identifier inserts and alerts every grants watcher once', () => {
  it('upserts once and emits exactly one funding_event alert for the watching project', async () => {
    const connector = fakeConnector([IHI]);
    const res = await syncFundingCalls({ sources: [connector], now });

    const src = res.sources[0];
    expect(src).toMatchObject({ source: 'sedia', ok: true, inserted: 1, updated: 0, alerts_created: 1, fetched: 1, skipped_gate: false });

    const upserts = callsMatching(queryMock, /INSERT INTO funding_calls/);
    expect(upserts).toHaveLength(1);
    // The `prev` CTE binds (source, identifier) first, then the spec's order:
    // id, source, identifier, url, title, body, deadline, time, status …
    expect(upserts[0].slice(1, 3)).toEqual(['sedia', IHI.source_identifier]);
    expect(upserts[0].slice(4, 12)).toEqual([
      'sedia', IHI.source_identifier, IHI.official_url, IHI.title, IHI.granting_body, '2027-04-21', null, 'open',
    ]);
    expect(String(upserts[0][3])).toMatch(/^fcall_/);
    expect(sqlOf(upserts[0])).toMatch(/WITH prev AS \(/);
    expect(sqlOf(upserts[0])).toMatch(/RETURNING id, \(xmax = 0\) AS inserted/);
    expect(sqlOf(upserts[0])).toMatch(/AS prev_status/);
    expect(sqlOf(upserts[0])).toMatch(/ON CONFLICT \(source, source_identifier\) DO UPDATE/);
    expect(sqlOf(upserts[0])).toMatch(/missed_syncs\s*=\s*0/);
    expect(sqlOf(upserts[0])).toMatch(/closed_at\s*=\s*NULL/);

    const alerts = callsMatching(queryMock, /INSERT INTO ecosystem_alerts/);
    expect(alerts).toHaveLength(1);
    const [sql, ...params] = alerts[0];
    expect(sql).toMatch(/'funding_event'/);
    expect(sql).toMatch(/ON CONFLICT DO NOTHING/);
    expect(sql).toMatch(/funding_call_id/);
    expect(params).toContain('grants:sedia');
    expect(params).toContain(IHI.official_url);
    expect(params).toContain('proj_it');
    expect(params).toContain('mon_it');
    expect(params).toContain('fcall_x');
    const headline = params.find((p) => typeof p === 'string' && /scade il/.test(p)) as string;
    expect(headline).toMatch(/scade il 21\/04\/2027/);
    expect(headline.length).toBeLessThanOrEqual(300);
    // entity is NULL on purpose: the SIGNAL_AUTOFLOW router would file every
    // later call from the same granting body as 'enrich' (no inbox ticket)
    // once a graph node named after that body exists.
    expect(sql).toMatch(/\?, NULL, 'pending', \?, \?\)/);
    expect(params).not.toContain(IHI.granting_body);
  });

  it('advances last_success_at with last_count = fetched only on a successful non-empty sync', async () => {
    await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    const state = callsMatching(runMock, /INSERT INTO funding_source_state/);
    expect(state).toHaveLength(1);
    expect(sqlOf(state[0])).toMatch(/last_success_at/);
    // (source, last_success_at, last_error = NULL on a complete listing, last_count, updated_at)
    expect(state[0].slice(1)).toEqual(['sedia', now.toISOString(), null, 1, now.toISOString()]);
  });

  it('rule 3: marks every identifier NOT in the sync as missed and closes at missed_syncs >= 2', async () => {
    const second: NormalizedCall = { ...IHI, source_identifier: 'HORIZON-CL5-2026-04-D3-02' };
    runMock.mockImplementation(async (sql: string) => (/missed_syncs >= 2/.test(sql) ? { count: 3 } : { count: 0 }));
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI, second])], now });

    const miss = callsMatching(runMock, /missed_syncs = missed_syncs \+ 1/);
    expect(miss).toHaveLength(1);
    expect(sqlOf(miss[0])).toMatch(/NOT \(source_identifier = ANY\(string_to_array\(\?, E'\\n'\)\)\)/);
    expect(miss[0][1]).toBe(now.toISOString());
    expect(miss[0][2]).toBe('sedia');
    expect(miss[0][3]).toBe([IHI.source_identifier, second.source_identifier].join('\n'));

    const close = callsMatching(runMock, /missed_syncs >= 2/);
    expect(close).toHaveLength(1);
    expect(sqlOf(close[0])).toMatch(/SET status = 'closed', closed_at = \?/);
    expect(res.sources[0].closed_missing).toBe(3);

    // A call present again resets missed_syncs to 0 in the upsert itself.
    const upsert = callsMatching(queryMock, /INSERT INTO funding_calls/)[0];
    expect(sqlOf(upsert)).toMatch(/DO UPDATE SET[\s\S]*missed_syncs\s*=\s*0/);
  });
});

describe('syncFundingCalls — rule 1: a KNOWN identifier updates in place and emits NO alert', () => {
  it('counts an update and never inserts an ecosystem_alert', async () => {
    routeQueries({ upsert: [{ ...UNCHANGED, id: 'fcall_known' }] });
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    expect(res.sources[0]).toMatchObject({ ok: true, inserted: 0, updated: 1, reopened: 0, alerts_created: 0, alerts_refreshed: 0 });
    expect(callsMatching(queryMock, /INSERT INTO funding_calls/)).toHaveLength(1);
    expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(0);
    // Nothing changed → no alert/ticket rewrite, no reopen.
    expect(callsMatching(runMock, /UPDATE ecosystem_alerts ea\s+SET headline/)).toHaveLength(0);
    expect(callsMatching(runMock, /SET reviewed_state = 'pending'/)).toHaveLength(0);
    // The in-place update refreshes deadline/status/last_verified_at.
    const sql = sqlOf(callsMatching(queryMock, /INSERT INTO funding_calls/)[0]);
    expect(sql).toMatch(/deadline\s*=\s*CASE WHEN[\s\S]*?ELSE excluded\.deadline END/);
    expect(sql).toMatch(/status\s*=\s*CASE WHEN[\s\S]*?ELSE excluded\.status END/);
    expect(sql).toMatch(/last_verified_at\s*=\s*excluded\.last_verified_at/);
  });

  it('never lets a Socrata-only re-sync overwrite a detail-page parse (regex) unless Socrata is LATER', async () => {
    // Day 2 of a Lombardia call: eligibility_text is set, so needsDetail
    // excludes it and the connector emits the Socrata-only date. The stored
    // page-derived deadline/hour/snippet/parse_method must survive — a
    // shorter Socrata date would otherwise expire a still-open call.
    routeQueries({ upsert: [UNCHANGED] });
    await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    const sql = sqlOf(callsMatching(queryMock, /INSERT INTO funding_calls/)[0]);
    expect(KEEP_PAGE_PARSE_SQL).toMatch(/funding_calls\.parse_method = 'regex'/);
    expect(KEEP_PAGE_PARSE_SQL).toMatch(/excluded\.parse_method = 'socrata_field'/);
    expect(KEEP_PAGE_PARSE_SQL).toMatch(/excluded\.deadline IS NULL OR excluded\.deadline <= funding_calls\.deadline/);
    expect(KEEP_PAGE_PARSE_SQL).toMatch(/funding_calls\.status <> 'closed'/);
    // Guarded columns: deadline, deadline_time, status, raw_snippet, parse_method.
    expect(sql.split(KEEP_PAGE_PARSE_SQL).length - 1).toBe(5);
    // page_status / page_error / page_checked_at: an incoming 'unread' (a
    // Socrata-only pass) must never erase what a detail fetch established.
    expect(KEEP_PAGE_STATUS_SQL).toBe("excluded.page_status = 'unread'");
    expect(sql.split(KEEP_PAGE_STATUS_SQL).length - 1).toBe(3);
    for (const col of ['page_status', 'page_error', 'page_checked_at']) {
      expect(sql).toMatch(new RegExp(`${col}\\s*=\\s*CASE WHEN excluded\\.page_status = 'unread' THEN funding_calls\\.${col}`));
    }
    for (const col of ['deadline', 'deadline_time', 'status', 'raw_snippet', 'parse_method']) {
      expect(sql).toMatch(new RegExp(`${col}\\s*=\\s*CASE WHEN \\(funding_calls\\.status <> 'closed'`));
    }
    // The stored hour is kept only when the date did not change — never a
    // 12:00 that belonged to another date.
    expect(sql).toMatch(/WHEN excluded\.deadline IS NOT DISTINCT FROM funding_calls\.deadline THEN funding_calls\.deadline_time\s+ELSE NULL END/);
  });
});

describe('syncFundingCalls — a KNOWN call whose deadline/status changed rewrites what the founder reads', () => {
  it('rewrites pending alert headlines/bodies and pending ticket titles in both locales, no new alert', async () => {
    routeQueries({ upsert: [upsertRow({ inserted: false, prev_status: 'open', prev_deadline: '2027-03-01', prev_deadline_time: null })] });
    runMock.mockImplementation(async (sql: string) => (/UPDATE ecosystem_alerts ea\s+SET headline/.test(sql) ? { count: 1 } : { count: 0 }));
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    expect(res.sources[0]).toMatchObject({ updated: 1, reopened: 0, alerts_created: 0, alerts_refreshed: 2 });

    const refresh = callsMatching(runMock, /UPDATE ecosystem_alerts ea\s+SET headline = \?, body = \?/);
    expect(refresh).toHaveLength(2);
    expect(refresh.map((c) => sqlOf(c))).toEqual([
      expect.stringMatching(/p\.locale = 'it'/),
      expect.stringMatching(/p\.locale IS NULL OR p\.locale <> 'it'/),
    ]);
    expect(refresh[0][1]).toMatch(/scade il 21\/04\/2027/);
    expect(refresh[1][1]).toMatch(/deadline 2027-04-21/);
    expect(refresh[0][3]).toBe('fcall_x');
    for (const c of refresh) expect(sqlOf(c)).toMatch(/ea\.reviewed_state = 'pending'/);

    const tickets = callsMatching(runMock, /UPDATE pending_actions pa\s+SET title = \?, rationale = \?, updated_at = \?/);
    expect(tickets).toHaveLength(2);
    expect(tickets[0][1]).toMatch(/scade il 21\/04\/2027/);
    expect(tickets[1][1]).toMatch(/deadline 2027-04-21/);
    for (const c of tickets) {
      expect(sqlOf(c)).toMatch(/pa\.action_type = 'signal_alert'/);
      expect(sqlOf(c)).toMatch(/pa\.status = 'pending'/); // an 'edited' ticket carries founder edits — untouched
    }
    expect(callsMatching(runMock, /SET reviewed_state = 'pending'/)).toHaveLength(0);
    expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(0);
  });

  it('a time-only change (hour added by the detail page) also rewrites', async () => {
    routeQueries({ upsert: [upsertRow({ inserted: false, deadline_time: '17:00', prev_status: 'open', prev_deadline: '2027-04-21', prev_deadline_time: null })] });
    await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    const refresh = callsMatching(runMock, /UPDATE ecosystem_alerts ea\s+SET headline/);
    expect(refresh).toHaveLength(2);
    expect(refresh[0][1]).toMatch(/scade il 21\/04\/2027 17:00/);
  });
});

describe('syncFundingCalls — a CLOSED call listed open again is reopened for founders too', () => {
  it('re-pends its auto-dismissed alerts and auto-rejected tickets, rewrites them, and alerts watchers without one', async () => {
    // Day 1: expiry closed X and auto-dismissed its alert + rejected its ticket.
    // Day 2: the source publishes a proroga → the upsert reopens the row (xmax != 0).
    routeQueries({ upsert: [upsertRow({ inserted: false, deadline: '2026-10-30', prev_status: 'closed', prev_deadline: '2026-09-05', prev_deadline_time: null })] });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await syncFundingCalls({ sources: [fakeConnector([{ ...IHI, deadline: '2026-10-30' }])], now });
    expect(res.sources[0]).toMatchObject({ updated: 1, reopened: 1 });

    const sqls = (runMock.mock.calls as Call[]).map(sqlOf);
    const repend = callsMatching(runMock, /SET reviewed_state = 'pending', reviewed_at = NULL, founder_action_taken = NULL/);
    expect(repend).toHaveLength(1);
    expect(sqlOf(repend[0])).toMatch(/reviewed_state = 'dismissed' AND founder_action_taken = 'auto_expired'/); // never a founder dismissal
    expect(repend[0][1]).toBe('fcall_x');

    const tickets = callsMatching(runMock, /SET status = 'pending', execution_result = NULL/);
    expect(tickets).toHaveLength(1);
    expect(sqlOf(tickets[0])).toMatch(/pa\.status = 'rejected'/);
    expect(sqlOf(tickets[0])).toMatch(/\(pa\.execution_result->>'auto_dismissed'\) = 'true'/);
    expect(sqlOf(tickets[0])).toMatch(/ea\.funding_call_id = \? AND ea\.reviewed_state = 'pending'/);
    expect(tickets[0].slice(1)).toEqual([now.toISOString(), 'fcall_x']);

    // Order: re-pend before the rewrite (the rewrite only touches pending rows).
    expect(sqls.findIndex((q) => /SET reviewed_state = 'pending'/.test(q))).toBeLessThan(sqls.findIndex((q) => /SET headline = \?/.test(q)));
    const refresh = callsMatching(runMock, /UPDATE ecosystem_alerts ea\s+SET headline/);
    expect(refresh).toHaveLength(2);
    expect(refresh[0][1]).toMatch(/scade il 30\/10\/2026/);

    // Watchers that never had an alert (activated after the first insert) get one now.
    const inserts = callsMatching(queryMock, /INSERT INTO ecosystem_alerts/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].find((p) => typeof p === 'string' && /scade il 30\/10\/2026/.test(p))).toBeTruthy();
    expect(logSpy.mock.calls.some((c) => /\[grants\] sedia: reopened 1 call/.test(String(c[0])))).toBe(true);
  });
});

describe('syncFundingCalls — a PARTIAL listing proves nothing about absent calls', () => {
  it('upserts what was fetched, SKIPS mark-missing, records truncated in last_error, still advances the gate', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI], false)], now });
    expect(res.sources[0]).toMatchObject({ ok: true, partial: true, fetched: 1, inserted: 1, closed_missing: 0, alerts_created: 1 });
    expect(callsMatching(queryMock, /INSERT INTO funding_calls/)).toHaveLength(1);
    expect(callsMatching(runMock, /missed_syncs/)).toHaveLength(0);
    const state = callsMatching(runMock, /INSERT INTO funding_source_state/);
    expect(state).toHaveLength(1);
    expect(sqlOf(state[0])).toMatch(/last_success_at/);
    expect(state[0].slice(1)).toEqual(['sedia', now.toISOString(), expect.stringMatching(/^truncated/), 1, now.toISOString()]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/\[grants\] sedia: listing INCOMPLETE .* mark-missing SKIPPED/));
  });

  it('a complete listing clears last_error', async () => {
    await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    const state = callsMatching(runMock, /INSERT INTO funding_source_state/);
    expect(state[0].slice(1)).toEqual(['sedia', now.toISOString(), null, 1, now.toISOString()]);
  });
});

describe('syncFundingCalls — needsDetail keeps rolling calls re-verifiable', () => {
  it('asks for never-enriched ids AND enriched rolling ids that are due (weekly bucket / pending miss)', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM monitors m/.test(sql)) return [WATCHER_IT];
      if (/INSERT INTO funding_calls/.test(sql)) return [upsertRow()];
      if (/INSERT INTO ecosystem_alerts/.test(sql)) return [{ id: 'ealr_x' }];
      if (/SELECT source_identifier FROM funding_calls/.test(sql)) return [{ source_identifier: 'ENRICHED-OPEN' }];
      return [];
    });
    let wanted: Set<string> | null = null;
    const connector = fakeConnector(async (o) => {
      wanted = await o.needsDetail!(['NEW', 'ENRICHED-OPEN', 'ROLLING-DUE']);
      return [IHI];
    });
    await syncFundingCalls({ sources: [connector], now });
    expect(wanted).toEqual(new Set(['NEW', 'ROLLING-DUE']));
    const lookup = callsMatching(queryMock, /SELECT source_identifier FROM funding_calls/);
    expect(lookup).toHaveLength(1);
    const sql = sqlOf(lookup[0]);
    expect(sql).toMatch(/eligibility_text IS NOT NULL/);
    // Enriched rolling rows are NOT excluded when a miss is pending or their weekly bucket is today.
    expect(sql).toMatch(/AND NOT \(\s*status = 'rolling'\s*AND \(missed_syncs > 0/);
    expect(sql).toMatch(/hashtext\(source_identifier\) % 7/);
    expect(sql).toMatch(/EXTRACT\(DOW FROM CURRENT_DATE\)::int/);
    expect(lookup[0].slice(1)).toEqual(['sedia', 'NEW\nENRICHED-OPEN\nROLLING-DUE']);
  });
});

describe('syncFundingCalls — phases outside the per-source loop fail LOUDLY with the [grants] prefix', () => {
  it('a watcher lookup failure aborts before any fetch and reports the error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    queryMock.mockImplementation(async (sql: string) => {
      if (/FROM monitors m/.test(sql)) throw new Error('relation "funding_calls" does not exist');
      return [];
    });
    const connector = fakeConnector([IHI]);
    const res = await syncFundingCalls({ sources: [connector], now });
    expect(res.sources).toEqual([]);
    expect(res.error).toMatch(/^loadGrantsWatchers: relation/);
    expect(connector.fetchCalls).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/^\[grants\] loadGrantsWatchers failed/), expect.any(String));
  });

  it('an expiry failure keeps the per-source results and reports the error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    runMock.mockImplementation(async (sql: string) => {
      if (/deadline < CURRENT_DATE/.test(sql)) throw new Error('boom');
      return { count: 0 };
    });
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    expect(res.sources[0]).toMatchObject({ ok: true, inserted: 1 });
    expect(res).toMatchObject({ expired: 0, alerts_dismissed: 0, error: 'expireFundingCalls: boom' });
    expect(errSpy).toHaveBeenCalledWith('[grants] expireFundingCalls failed:', 'boom');
  });
});

describe('syncFundingCalls — rule 4: ZERO rows is an alarm, never a mass closure', () => {
  it('logs console.error, writes last_error, and touches neither missed_syncs nor last_success_at', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await syncFundingCalls({ sources: [fakeConnector([])], now });

    expect(res.sources[0]).toMatchObject({ ok: false, error: 'zero_results', fetched: 0, closed_missing: 0, inserted: 0 });
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/\[grants\] sedia returned 0 calls/));

    expect(callsMatching(runMock, /missed_syncs/)).toHaveLength(0);
    expect(callsMatching(runMock, /last_success_at/)).toHaveLength(0);
    expect(callsMatching(queryMock, /INSERT INTO funding_calls/)).toHaveLength(0);
    const errWrite = callsMatching(runMock, /last_error = \?/);
    expect(errWrite).toHaveLength(1);
    expect(errWrite[0][1]).toBe('zero_results');
  });

  it('a connector that throws records the error and performs no upsert / closure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const connector = fakeConnector(async () => {
      throw new Error('[grants] sedia HTTP 500 on page 1: internal');
    });
    const res = await syncFundingCalls({ sources: [connector], now });

    expect(res.sources[0].ok).toBe(false);
    expect(res.sources[0].error).toMatch(/HTTP 500/);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/\[grants\] sedia fetch failed/), expect.any(String));
    expect(callsMatching(runMock, /last_error/)).toHaveLength(1);
    expect(callsMatching(runMock, /missed_syncs/)).toHaveLength(0);
    expect(callsMatching(runMock, /last_success_at/)).toHaveLength(0);
    expect(callsMatching(queryMock, /INSERT INTO funding_calls/)).toHaveLength(0);
    // The sync as a whole still returns (the cron never sees a throw) and expiry still ran.
    expect(callsMatching(runMock, /deadline < CURRENT_DATE/)).toHaveLength(1);
  });
});

describe('syncFundingCalls — rule 6: once per calendar day per source, gated on last_success_at', () => {
  it('skips the fetch when funding_source_state says it already ran today', async () => {
    getMock.mockResolvedValue({ ran_today: true });
    const connector = fakeConnector([IHI]);
    const res = await syncFundingCalls({ sources: [connector], now });
    expect(res.sources[0]).toMatchObject({ skipped_gate: true, ok: true, fetched: 0 });
    expect(connector.fetchCalls).not.toHaveBeenCalled();
    expect(sqlOf(getMock.mock.calls[0] as Call)).toMatch(/last_success_at >= CURRENT_DATE/);
    expect(getMock.mock.calls[0][1]).toBe('sedia');
    // Expiry is gate-independent.
    expect(callsMatching(runMock, /deadline < CURRENT_DATE/)).toHaveLength(1);
  });

  it('force bypasses the gate', async () => {
    getMock.mockResolvedValue({ ran_today: true });
    const connector = fakeConnector([IHI]);
    const res = await syncFundingCalls({ sources: [connector], now, force: true });
    expect(connector.fetchCalls).toHaveBeenCalledTimes(1);
    expect(res.sources[0].skipped_gate).toBe(false);
  });
});

describe('syncFundingCalls — projects without an active grants monitor get nothing', () => {
  it('upserts the call but inserts no alert when there are no watchers', async () => {
    routeQueries({ watchers: [] });
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    expect(res.sources[0]).toMatchObject({ inserted: 1, alerts_created: 0 });
    expect(callsMatching(queryMock, /INSERT INTO funding_calls/)).toHaveLength(1);
    expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(0);
  });

  it('one alert per watching project', async () => {
    routeQueries({ watchers: [WATCHER_IT, { project_id: 'proj_en', monitor_id: 'mon_en', locale: 'en' }] });
    const res = await syncFundingCalls({ sources: [fakeConnector([IHI])], now });
    expect(res.sources[0].alerts_created).toBe(2);
    const alerts = callsMatching(queryMock, /INSERT INTO ecosystem_alerts/);
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a[2])).toEqual(['proj_it', 'proj_en']);
    const enHeadline = alerts[1].find((p) => typeof p === 'string' && /deadline 2027-04-21/.test(p));
    expect(enHeadline).toBeTruthy();
  });
});

describe('expireFundingCalls — rule 5', () => {
  it('closes past-deadline calls, then auto-dismisses their alerts and tickets in order', async () => {
    runMock
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValueOnce({ count: 3 })
      .mockResolvedValueOnce({ count: 1 });
    const res = await expireFundingCalls(now);
    expect(res).toEqual({ expired: 2, alerts_dismissed: 3 });

    const sqls = (runMock.mock.calls as Call[]).map(sqlOf);
    expect(sqls).toHaveLength(3);
    expect(sqls[0]).toMatch(/deadline < CURRENT_DATE/);
    expect(sqls[0]).toMatch(/status = 'open'/);
    expect(sqls[1]).toMatch(/reviewed_state = 'dismissed'/);
    expect(sqls[1]).toMatch(/founder_action_taken = 'auto_expired'/);
    expect(sqls[1]).toMatch(/reviewed_state = 'pending'/);
    expect(sqls[2]).toMatch(/action_type = 'signal_alert'/);
    expect(sqls[2]).toContain('"reason":"funding call closed"');
    // The cron's auto-dismiss convention, verbatim.
    expect(sqls[2]).toMatch(/SET status = 'rejected',\s*\n\s*updated_at = \?,\s*\n\s*execution_result = COALESCE\(pa\.execution_result, '\{"auto_dismissed":true/);
    expect(sqls[2]).toMatch(/WHERE pa\.status IN \('pending', 'edited'\)/);
  });
});

describe('buildGrantAlertContent', () => {
  it('it: headline carries DD/MM/YYYY + time, body carries eligibility and verification date', () => {
    const { headline, body } = buildGrantAlertContent(
      { title: 'Bando Tertium', granting_body: 'Regione Lombardia', deadline: '2026-09-07', deadline_time: '12:00', status: 'open', eligibility_text: 'PMI lombarde' },
      'it',
      now,
    );
    expect(headline).toBe('Bando Tertium — Regione Lombardia · scade il 07/09/2026 12:00');
    expect(body).toContain('Chi può partecipare: PMI lombarde');
    expect(body).toContain('Verificato il 01/09/2026');
  });

  it('keeps the deadline on the tail of a headline that would overflow 300 chars — the budget comes out of the title', () => {
    const title = 'PR FESR 2021-2027 AZIONE 1.3.1 SOSTEGNO ALLA CREAZIONE DI NUOVE IMPRESE INNOVATIVE E AL CONSOLIDAMENTO DELLE START UP LOMBARDE ATTRAVERSO SERVIZI DI ACCOMPAGNAMENTO SECONDO SPORTELLO 2026 PROROGA X'.padEnd(200, 'Y');
    const granting_body = 'Regione Lombardia — ISTRUZIONE, UNIVERSITÀ, RICERCA, INNOVAZIONE E SEMPLIFICAZIONE (PR Lombardia FESR 2021-2027)';
    expect(title.length).toBe(200);
    expect(granting_body.length).toBe(112);
    const { headline } = buildGrantAlertContent(
      { title, granting_body, deadline: '2026-09-07', deadline_time: '12:00', status: 'open', eligibility_text: null },
      'it',
      now,
    );
    expect(headline.length).toBeLessThanOrEqual(300);
    expect(headline.endsWith(' · scade il 07/09/2026 12:00')).toBe(true);
    expect(headline).toContain(`— ${granting_body} ·`); // the body survives intact (≤ 120)
    expect(headline.startsWith('PR FESR 2021-2027 AZIONE 1.3.1')).toBe(true);
    expect(headline).toContain('…'); // the title is what got cut

    // A very long granting body is capped at 120 so the title keeps room.
    const long = buildGrantAlertContent(
      { title, granting_body: 'B'.repeat(400), deadline: '2027-04-21', deadline_time: null, status: 'open', eligibility_text: null },
      'en',
      now,
    );
    expect(long.headline.length).toBeLessThanOrEqual(300);
    expect(long.headline.endsWith(' · deadline 2027-04-21')).toBe(true);
    expect(long.headline).toContain(`${'B'.repeat(119)}…`);
  });

  it('en rolling: no date, explicit "until funds are exhausted"', () => {
    const { headline, body } = buildGrantAlertContent(
      { title: 'PR FESR sportello', granting_body: null, deadline: null, deadline_time: null, status: 'rolling', eligibility_text: null },
      'en',
      now,
    );
    expect(headline.endsWith('· deadline open until funds are exhausted')).toBe(true);
    expect(headline).toContain('granting body not stated');
    expect(body).toContain('see the official call page');
    expect(body).toContain('Verified on 2026-09-01');
  });
});

describe('legacy LLM gate — rule 7: a GRANTS-monitor funding_event needs a FUTURE deadline in the headline', () => {
  const persistOpts = { projectId: 'proj_x', monitorId: 'mon_x', monitorRunId: 'run_x', monitorType: 'ecosystem.grants' };
  const alert = (headline: string) => ({
    alert_type: 'funding_event' as const,
    headline,
    body: 'Two sentences.',
    source_url: 'https://www.bandi.regione.lombardia.it/servizi/servizio/bandi/dettaglio/RLP12026052483',
    relevance_score: 0.5,
    confidence: 0.7,
    suggested_action: null,
    entity: null,
  });

  it('discards a headline whose date 04/03/2026 is in the past on 2026-09-01', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await persistEcosystemAlerts(
      [alert('Bando Voucher Digitali — Regione Lombardia, scadenza 04/03/2026')],
      persistOpts,
    );
    expect(res.alerts_inserted).toBe(0);
    expect(res.alerts_skipped).toBe(1);
    expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ecosystem-alerts\] funding_event without a future deadline in the headline DISCARDED/),
      '04/03/2026 — ',
      expect.stringContaining('Bando Voucher Digitali'),
    );
  });

  it('discards a headline with no parseable date at all', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await persistEcosystemAlerts([alert('EIC Accelerator 2026 — rolling call')], persistOpts);
    expect(res.alerts_skipped).toBe(1);
    expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/DISCARDED/), 'no date — ', expect.any(String));
  });

  it('keeps a headline whose latest date is strictly in the future', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await persistEcosystemAlerts(
      [alert('Bando Tertium — Regione Lombardia, apre 01/10/2026, scade il 15/12/2026')],
      persistOpts,
    );
    expect(res.alerts_skipped).toBe(0);
    expect(res.alerts_inserted).toBe(1);
    expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(1);
  });

  it('today is NOT future — a deadline of 01/09/2026 on 2026-09-01 is discarded', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T00:00:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await persistEcosystemAlerts([alert('Bando X, scade il 01/09/2026')], persistOpts);
    expect(res.alerts_skipped).toBe(1);
  });

  it('is scoped to the grants monitor: a competitor funding round (no deadline) from another monitor is KEPT', async () => {
    // funding_event is shared by every ecosystem monitor (competitor rounds,
    // trend signals, chat "funding" watchers). Those carry no application
    // deadline — gating them would silently starve the inbox and the
    // intelligence correlator of every funding round.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00Z'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const round = { ...alert('Acme raises €5M Series A'), source_url: 'https://techcrunch.com/2026/09/01/acme-series-a' };
    for (const monitorType of ['ecosystem.competitors', undefined]) {
      queryMock.mockClear();
      const res = await persistEcosystemAlerts([round], { ...persistOpts, monitorType });
      expect(res.alerts_skipped, `monitorType=${monitorType}`).toBe(0);
      expect(res.alerts_inserted).toBe(1);
      expect(callsMatching(queryMock, /INSERT INTO ecosystem_alerts/)).toHaveLength(1);
    }
    expect(warnSpy.mock.calls.some((c) => /DISCARDED/.test(String(c[0])))).toBe(false);
    // …while the same headline from the grants monitor is discarded.
    const res = await persistEcosystemAlerts([round], persistOpts);
    expect(res.alerts_skipped).toBe(1);
  });
});

describe('source pins', () => {
  it('the daily grants sync streams from its own cron endpoint and is NOT inline in /api/cron', () => {
    // A full three-source sync takes ~75s; inline in /api/cron it would be
    // killed at Netlify's 26s sync-function limit every day, never advancing
    // last_success_at. It must live behind a streamed endpoint the scheduler
    // consumes with curl -N, exactly like run-monitor.
    const cron = read('src/app/api/cron/route.ts');
    expect(cron).not.toMatch(/syncFundingCalls/);
    expect(cron).toMatch(/GET \/api\/cron\/grants/);
    const route = read('src/app/api/cron/grants/route.ts');
    expect(route).toMatch(/export const maxDuration = 300;/);
    expect(route).toMatch(/requireCronAuth\(request\)/);
    expect(route).toMatch(/syncFundingCalls\(\{ now: new Date\(\), force \}\)/);
    expect(route).toMatch(/'Content-Type': 'text\/event-stream'/);
    // The DAILY sync is the background function, not this route: streaming does
    // not extend a Netlify function (measured 2026-09-02 — heartbeats to 30s,
    // then the connection died with nothing synced).
    const wf = read('.github/workflows/scheduled-cron.yml');
    expect(wf).toMatch(/\/\.netlify\/functions\/grants-sync-background/);
    expect(wf).not.toMatch(/curl -sN[^\n]*\/api\/cron\/grants/);
    const bg = read('netlify/functions/grants-sync-background.mts');
    expect(bg).toMatch(/syncFundingCalls\(\{ now: new Date\(\) \}\)/);
    // Publicly addressable, so the secret gate is the only protection.
    expect(bg).toMatch(/Bearer \$\{secret\}/);
    expect(bg).toMatch(/status: 401/);
  });

  it('the legacy parser gates funding_event on a headline deadline — for the grants monitor only', () => {
    const parser = read('src/lib/ecosystem-alert-parser.ts');
    expect(parser).toMatch(/extractDeadlineFromHeadline\(alert\.headline/);
    expect(parser).toMatch(/isFutureDate\(found\.date, new Date\(\)\)/);
    expect(parser).toMatch(/alert\.alert_type === 'funding_event' && opts\.monitorType === 'ecosystem\.grants'/);
    // Every producer passes the monitor type, so the gate can tell grants from rounds.
    expect(read('src/app/api/cron/route.ts')).toMatch(/monitorRunId: runId,\s*\n\s*monitorType: monitor\.type,/);
    expect(read('src/lib/monitor-run-stream.ts')).toMatch(/monitorRunId: runId,\s*\n\s*monitorType,/);
    expect(read('src/lib/monitor-extract.ts')).toMatch(/monitorRunId: input\.monitorRunId,\s*\n\s*monitorType: input\.monitorType,/);
  });

  it('the sync selects only ACTIVE ecosystem.grants monitors on non-archived projects', () => {
    const sync = read('src/lib/grants/sync.ts');
    expect(sync).toMatch(/m\.type = 'ecosystem\.grants'\s*\n\s*AND m\.status = 'active'/);
    expect(sync).toMatch(/JOIN projects p ON p\.id = m\.project_id AND p\.status != 'archived'/);
  });

  it('the prompt asks the model for a parseable date format in both locales', () => {
    const monitors = read('src/lib/ecosystem-monitors.ts');
    expect(monitors).toContain('nella headline, nel formato GG/MM/AAAA.');
    expect(monitors).toContain('in the headline, formatted DD/MM/YYYY.');
  });

  it('both i18n catalogs carry the grants alert keys', () => {
    for (const f of ['src/lib/i18n/messages/en.ts', 'src/lib/i18n/messages/it.ts']) {
      const cat = read(f);
      for (const key of ['grants.alert.headline', 'grants.alert.rolling', 'grants.alert.body', 'grants.alert.no-eligibility', 'grants.alert.body-unknown']) {
        expect(cat, `${f} missing ${key}`).toContain(`'${key}':`);
      }
    }
  });
});

describe('jsonb binding — facets must be bound as a RAW object', () => {
  it('binds facets as an object, never a pre-stringified JSON string (double-encode trap)', async () => {
    queryMock.mockReset(); runMock.mockReset(); getMock.mockReset();
    getMock.mockResolvedValue({ ran_today: false });
    queryMock.mockImplementation(async (sql: string) => {
      if (/INSERT INTO funding_calls/.test(sql)) return [{ id: 'fcall_x', inserted: true, status: 'open', deadline: '2026-10-01', deadline_time: null, prev_status: null, prev_deadline: null, prev_deadline_time: null }];
      return [];
    });
    runMock.mockResolvedValue({ count: 0 });
    const facets = { subject_types: ['Impresa'], scopes: ['Digitalizzazione'], support_forms: ['Contributo/Fondo perduto'], ateco: null, national: true };
    const call: NormalizedCall = { ...IHI, source: 'incentivi', source_identifier: 'nid-1', official_url: 'https://example.gov.it/x', regions: ['Toscana'], facets, source_note: null, catalog_url: 'https://www.incentivi.gov.it/it/catalogo/x' };
    const conn = fakeConnector([call]); (conn as { source: string }).source = 'incentivi';
    await syncFundingCalls({ sources: [conn], now });
    const args = callsMatching(queryMock, /INSERT INTO funding_calls/)[0] as unknown[];
    expect(args.some((a) => a && typeof a === 'object' && !Array.isArray(a) && 'national' in (a as object))).toBe(true);
    expect(args.some((a) => typeof a === 'string' && a.startsWith('{"subject_types"'))).toBe(false);
    expect(args.some((a) => Array.isArray(a) && a[0] === 'Toscana')).toBe(true);
  });
});
