import { describe, it, expect } from 'vitest';
import {
  applyFilters,
  chipCounts,
  classifyFreshness,
  countdownParts,
  deadlineBucket,
  excerptEligibility,
  matchesQuery,
  relativeAge,
  sortCalls,
  statusPillKind,
  type FundingCallView,
} from './view';

// Local-time constructor → deterministic in any TZ.
const NOW = new Date(2026, 8, 2, 10, 0, 0);
const HOUR = 60 * 60 * 1000;

let seq = 0;
function mk(over: Partial<FundingCallView> = {}): FundingCallView {
  seq += 1;
  return {
    id: `fc_${seq}`,
    source: 'sedia',
    title: `Call ${seq}`,
    granting_body: 'European Commission',
    official_url: 'https://example.org/call',
    deadline: '2026-10-15',
    deadline_time: null,
    status: 'open',
    eligibility_text: null,
    page_status: 'n/a',
    page_error: null,
    page_checked_at: null,
    regions: null,
    facets: null,
    source_note: null,
    catalog_url: null,
    last_verified_at: '2026-09-01T06:00:00.000Z',
    alerted: false,
    ...over,
  };
}

function agoIso(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe('countdownParts', () => {
  it('counts calendar days from the local date of now', () => {
    expect(countdownParts('2026-09-02', NOW)).toEqual({ days: 0 });
    expect(countdownParts('2026-09-03', NOW)).toEqual({ days: 1 });
    expect(countdownParts('2026-09-09', NOW)).toEqual({ days: 7 });
    expect(countdownParts('2026-10-02', NOW)).toEqual({ days: 30 });
    expect(countdownParts('2026-10-03', NOW)).toEqual({ days: 31 });
    expect(countdownParts('2026-09-01', NOW)).toEqual({ days: -1 });
  });

  it('returns null for null or malformed deadlines', () => {
    expect(countdownParts(null, NOW)).toBeNull();
    expect(countdownParts('garbage', NOW)).toBeNull();
  });
});

describe('deadlineBucket / statusPillKind', () => {
  const cases: Array<[string, string | null, 'open' | 'rolling' | 'closed', string, string]> = [
    ['day 0', '2026-09-02', 'open', 'closing-soon', 'warn'],
    ['day 7', '2026-09-09', 'open', 'closing-soon', 'warn'],
    ['day 8', '2026-09-10', 'open', 'closing-soon', 'ok'],
    ['day 30', '2026-10-02', 'open', 'closing-soon', 'ok'],
    ['day 31', '2026-10-03', 'open', 'open', 'ok'],
    ['rolling', null, 'rolling', 'rolling', 'info'],
    ['open with null deadline', null, 'open', 'rolling', 'info'],
  ];
  for (const [label, deadline, status, bucket, kind] of cases) {
    it(`${label} → ${bucket}/${kind}`, () => {
      const call = mk({ deadline, status });
      expect(deadlineBucket(call, NOW)).toBe(bucket);
      expect(statusPillKind(call, NOW)).toBe(kind);
    });
  }

  it('closed → n', () => {
    expect(statusPillKind(mk({ status: 'closed', deadline: '2026-09-01' }), NOW)).toBe('n');
    expect(statusPillKind(mk({ status: 'closed', deadline: null }), NOW)).toBe('n');
  });
});

describe('sortCalls', () => {
  it('sorts deadline ASC, nulls last, ties by title, without mutating input', () => {
    const rolling = mk({ status: 'rolling', deadline: null, title: 'Rolling' });
    const dec = mk({ deadline: '2026-12-01', title: 'December' });
    const sepC = mk({ deadline: '2026-09-10', title: 'C' });
    const sepB = mk({ deadline: '2026-09-10', title: 'B' });
    const sepA = mk({ deadline: '2026-09-10', title: 'A' });
    const input = [rolling, dec, sepC, sepB, sepA];
    const snapshot = [...input];
    const sorted = sortCalls(input);
    expect(sorted.map((c) => c.title)).toEqual(['A', 'B', 'C', 'December', 'Rolling']);
    expect(input).toEqual(snapshot);
    expect(sorted).not.toBe(input);
  });
});

describe('classifyFreshness', () => {
  it('healthy under 36h with no error', () => {
    expect(classifyFreshness(agoIso(35 * HOUR), null, NOW)).toBe('healthy');
  });
  it('stale between 36h and 72h', () => {
    expect(classifyFreshness(agoIso(36 * HOUR), null, NOW)).toBe('stale');
    expect(classifyFreshness(agoIso(71 * HOUR + 59 * 60 * 1000), null, NOW)).toBe('stale');
  });
  it('dead at 72h or with no success', () => {
    expect(classifyFreshness(agoIso(72 * HOUR), null, NOW)).toBe('dead');
    expect(classifyFreshness(null, null, NOW)).toBe('dead');
  });
  it('a real error is dead even with a recent success', () => {
    expect(classifyFreshness(agoIso(1 * HOUR), 'zero_results', NOW)).toBe('dead');
  });
  it('a truncated warning is stale at best', () => {
    expect(
      classifyFreshness(agoIso(1 * HOUR), 'truncated: 800 call(s) fetched, listing incomplete', NOW),
    ).toBe('stale');
    expect(
      classifyFreshness(agoIso(80 * HOUR), 'truncated: 800 call(s) fetched, listing incomplete', NOW),
    ).toBe('dead');
  });
  it('parses ISO strings and rejects garbage', () => {
    expect(classifyFreshness('2026-09-02T09:00:00.000Z', null, new Date('2026-09-02T10:00:00.000Z'))).toBe('healthy');
    expect(classifyFreshness('not a date', null, NOW)).toBe('dead');
  });
  it('negative age is healthy', () => {
    expect(classifyFreshness(agoIso(-2 * HOUR), null, NOW)).toBe('healthy');
  });
});

describe('matchesQuery / applyFilters / chipCounts', () => {
  const fixture = (): FundingCallView[] => [
    mk({ source: 'sedia', title: 'Horizon Europe — Cluster 4', granting_body: 'European Commission', deadline: '2026-09-05' }),
    mk({ source: 'sedia', title: 'Digital Europe call', granting_body: null, deadline: '2026-12-01' }),
    mk({ source: 'lombardia', title: 'Bando Innovazione', granting_body: 'Regione Lombardia', deadline: '2026-09-20' }),
    mk({ source: 'lombardia', title: 'Bando Sportello', granting_body: 'Regione Lombardia', status: 'rolling', deadline: null }),
    mk({ source: 'lombardia', title: 'Bando Ricerca', granting_body: 'Regione Lombardia', deadline: '2027-01-15' }),
  ];

  it('matches title case-insensitively', () => {
    expect(matchesQuery(fixture()[0], 'HORIZON')).toBe(true);
    expect(matchesQuery(fixture()[0], '  horizon ')).toBe(true);
  });
  it('matches granting_body and tolerates null body', () => {
    expect(matchesQuery(fixture()[2], 'regione')).toBe(true);
    expect(() => matchesQuery(fixture()[1], 'regione')).not.toThrow();
    expect(matchesQuery(fixture()[1], 'regione')).toBe(false);
  });
  it('empty query matches everything', () => {
    expect(matchesQuery(fixture()[1], '')).toBe(true);
    expect(matchesQuery(fixture()[1], '   ')).toBe(true);
  });

  it('chipCounts on the fixture', () => {
    expect(chipCounts(fixture(), NOW)).toEqual({
      all: 5,
      'closing-soon': 2,
      rolling: 1,
      sedia: 2,
      lombardia: 3,
      incentivi: 0,
    });
  });

  it('applyFilters combines chip + query and sorts', () => {
    const out = applyFilters(fixture(), { chip: 'lombardia', q: 'bando' }, NOW);
    expect(out.map((c) => c.title)).toEqual(['Bando Innovazione', 'Bando Ricerca', 'Bando Sportello']);
    expect(out.every((c) => c.source === 'lombardia')).toBe(true);
    expect(applyFilters(fixture(), { chip: 'lombardia', q: 'innovazione' }, NOW)).toHaveLength(1);
    expect(applyFilters(fixture(), { chip: 'closing-soon', q: '' }, NOW).map((c) => c.deadline)).toEqual([
      '2026-09-05',
      '2026-09-20',
    ]);
    expect(applyFilters(fixture(), { chip: 'rolling', q: '' }, NOW)).toHaveLength(1);
    expect(applyFilters(fixture(), { chip: 'all', q: '' }, NOW)).toHaveLength(5);
  });
});

describe('excerptEligibility', () => {
  it('cuts long text at a word boundary with an ellipsis', () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ').slice(0, 300);
    expect(text.length).toBe(300);
    const { short, truncated } = excerptEligibility(text);
    expect(truncated).toBe(true);
    expect(short.length).toBeLessThanOrEqual(281);
    expect(short.endsWith('…')).toBe(true);
    const body = short.slice(0, -1);
    expect(body.endsWith(' ')).toBe(false);
    expect(text.startsWith(body)).toBe(true);
    expect(text[body.length]).toBe(' ');
  });
  it('returns short text unchanged', () => {
    const text = 'a'.repeat(100);
    expect(excerptEligibility(text)).toEqual({ short: text, truncated: false });
  });
  it('handles null and empty', () => {
    expect(excerptEligibility(null)).toEqual({ short: '', truncated: false });
    expect(excerptEligibility('')).toEqual({ short: '', truncated: false });
  });
  it('collapses whitespace and newlines', () => {
    expect(excerptEligibility('  SMEs  and\n\nstart-ups\t established   in\nItaly ')).toEqual({
      short: 'SMEs and start-ups established in Italy',
      truncated: false,
    });
  });
});

describe('relativeAge', () => {
  it('buckets ages into whole units', () => {
    expect(relativeAge(agoIso(30 * 1000), NOW)).toEqual({ unit: 'now', n: 0 });
    expect(relativeAge(agoIso(5 * 60 * 1000), NOW)).toEqual({ unit: 'minutes', n: 5 });
    expect(relativeAge(agoIso(3 * HOUR), NOW)).toEqual({ unit: 'hours', n: 3 });
    expect(relativeAge(agoIso(40 * HOUR), NOW)).toEqual({ unit: 'hours', n: 40 });
    expect(relativeAge(agoIso(3 * 24 * HOUR), NOW)).toEqual({ unit: 'days', n: 3 });
    expect(relativeAge(agoIso(20 * 24 * HOUR), NOW)).toEqual({ unit: 'weeks', n: 2 });
  });
  it('returns null for null or garbage', () => {
    expect(relativeAge(null, NOW)).toBeNull();
    expect(relativeAge('garbage', NOW)).toBeNull();
  });
});

describe('statusPillKind — expired but not yet closed by the daily sync', () => {
  it("an 'open' call whose deadline has passed is 'n', never 'warn'", () => {
    // expireFundingCalls closes `deadline < CURRENT_DATE` once a day in UTC;
    // until then the row must not say "Closes this week" next to "expired".
    expect(statusPillKind(mk({ status: 'open', deadline: '2026-09-01' }), NOW)).toBe('n');
    expect(statusPillKind(mk({ status: 'open', deadline: '2026-08-20' }), NOW)).toBe('n');
    // Today and the next 7 days are still urgent.
    expect(statusPillKind(mk({ status: 'open', deadline: '2026-09-02' }), NOW)).toBe('warn');
    expect(statusPillKind(mk({ status: 'open', deadline: '2026-09-09' }), NOW)).toBe('warn');
  });
});
