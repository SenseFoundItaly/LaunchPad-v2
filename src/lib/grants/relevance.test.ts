import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractProjectSignals, normalize, MIN_TERMS_FOR_RANKING } from './project-signals';
import { buildFacetIdf, scoreCall, rankCalls, RELEVANT_THRESHOLD, relevantOnly } from './relevance';
import { sortByRelevance, applyFilters } from './view';
import type { FundingCallView } from './view';

/**
 * Grant ranking with ZERO model calls — the founder's own validation text,
 * matched against the sources' controlled vocabulary, scored by arithmetic.
 *
 * These tests hold the two properties that make that defensible: the ranking is
 * a pure function of its inputs (so it can be reasoned about and replayed), and
 * the ranking modules cannot reach a model even by accident.
 */

const call = (over: Partial<FundingCallView> = {}): FundingCallView => ({
  id: over.id ?? 'fcall_1',
  source: 'incentivi',
  title: 'Contributi alle imprese',
  granting_body: 'MIMIT',
  official_url: 'https://example.org/x',
  deadline: null,
  deadline_time: null,
  status: 'rolling',
  eligibility_text: null,
  last_verified_at: '2026-09-02T00:00:00.000Z',
  alerted: false,
  page_status: 'unread',
  page_error: null,
  page_checked_at: null,
  regions: null,
  facets: null,
  source_note: null,
  catalog_url: null,
  ...over,
});

const NOW = new Date('2026-09-02T12:00:00Z');
const signalsFor = (description: string) => extractProjectSignals({ name: 'P', description });

describe('project signals come only from the founder\'s own words', () => {
  it('reads a region from the city a founder actually names', () => {
    expect(signalsFor('Caffè in abbonamento per uffici a Milano').regions).toEqual(['Lombardia']);
    expect(signalsFor('Logistica per il porto di Genova').regions).toEqual(['Liguria']);
    // No place named ⇒ no region invented.
    expect(signalsFor('Piattaforma SaaS per PMI').regions).toEqual([]);
  });

  it('maps the text onto the sources\' own scope vocabulary', () => {
    const s = signalsFor('SaaS di carbon accounting per PMI manifatturiere: report ESG automatici');
    expect(s.scopes).toContain('Digitalizzazione');
    expect(s.scopes).toContain('Transizione ecologica');
    expect(s.subjectTypes).toContain('Impresa');
  });

  it('never guesses "company not formed yet" from the pipeline step', () => {
    // It fired for every early project, matched 42 calls, and pushed noise to
    // the top on the first live run — a signal true of everyone ranks nothing.
    const s = extractProjectSignals({ description: 'Piattaforma SaaS per PMI', current_step: 1 });
    expect(s.subjectTypes).not.toContain('Impresa da costituire - Altro');
  });

  it('refuses to rank on too little text', () => {
    expect(extractProjectSignals({ description: 'App' }).usable).toBe(false);
    expect(signalsFor('Piattaforma SaaS di carbon accounting per PMI manifatturiere italiane').usable).toBe(true);
  });

  it('normalises accents and punctuation so matching is stable', () => {
    expect(normalize('Caffè, in abbonamento!')).toBe('caffe in abbonamento');
  });

  it('is a pure function — same input, same signals', () => {
    const text = 'Piattaforma SaaS di carbon accounting per PMI manifatturiere italiane con sede a Milano, report ESG automatici';
    const a = signalsFor(text);
    const b = signalsFor(text);
    expect(a).toEqual(b);
    expect(a.terms.length).toBeGreaterThanOrEqual(MIN_TERMS_FOR_RANKING);
  });
});

describe('a facet match is worth what it tells you, not a flat amount', () => {
  it('a near-universal facet scores far below a rare one', () => {
    // Live corpus: 'Impresa' sits on 581 of 659 tagged calls, so matching it
    // says almost nothing; 'Imprenditoria femminile' (48) says a lot.
    const corpus = [
      ...Array.from({ length: 90 }, (_, i) => call({ id: `c${i}`, facets: { subject_types: ['Impresa'], scopes: [], support_forms: [], ateco: null, national: false } })),
      call({ id: 'rare', facets: { subject_types: ['Impresa'], scopes: ['Imprenditoria femminile'], support_forms: [], ateco: null, national: false } }),
    ];
    const idf = buildFacetIdf(corpus);
    expect(idf.subjects.get('Impresa')!).toBeLessThan(0.2);
    expect(idf.scopes.get('Imprenditoria femminile')!).toBeGreaterThan(0.6);
  });
});

describe('scoring', () => {
  const idfOf = (calls: FundingCallView[]) => buildFacetIdf(calls);

  it('region pays full only when something else about the call also matches', () => {
    // Measured 2026-09-02: region alone put thesis prizes and a mountain-guide
    // course at the top of a Milan project's list.
    const signals = signalsFor('Caffè in abbonamento per uffici a Milano');
    const bare = call({ id: 'bare', regions: ['Lombardia'], title: 'Premi per tesi di laurea' });
    const corpus = [bare];
    const scored = scoreCall(bare, signals, NOW, idfOf(corpus));
    expect(scored.score).toBeLessThan(RELEVANT_THRESHOLD);
    expect(scored.reasons.some((r) => r.kind === 'region')).toBe(true);
  });

  it('a call for other regions only sinks, but is never removed', () => {
    const signals = signalsFor('Caffè in abbonamento per uffici a Milano');
    const elsewhere = call({ id: 'e', regions: ['Sicilia'] });
    const scored = scoreCall(elsewhere, signals, NOW, idfOf([elsewhere]));
    expect(scored.score).toBeLessThan(0);
    // rankCalls returns every call it was given — filtering is the founder's.
    expect(rankCalls([elsewhere], signals, NOW)).toHaveLength(1);
  });

  it('with no region known, a hyper-local scheme ranks below a national one', () => {
    const signals = signalsFor('Piattaforma SaaS di carbon accounting per PMI manifatturiere');
    const local = call({ id: 'l', regions: ['Molise'] });
    const national = call({ id: 'n', regions: ['Molise', 'Lazio'], facets: { subject_types: [], scopes: [], support_forms: [], ateco: null, national: true } });
    const idf = idfOf([local, national]);
    expect(scoreCall(national, signals, NOW, idf).score)
      .toBeGreaterThan(scoreCall(local, signals, NOW, idf).score);
  });

  it('EU calls are treated as applying everywhere', () => {
    const signals = signalsFor('Piattaforma SaaS di carbon accounting per PMI manifatturiere');
    const eu = call({ id: 'eu', source: 'sedia' });
    const r = scoreCall(eu, signals, NOW, idfOf([eu]));
    expect(r.reasons.find((x) => x.kind === 'national')?.label).toBe('EU');
  });

  it('a Lombardy-feed call carries its region even with no tags', () => {
    const signals = signalsFor('Caffè in abbonamento per uffici a Milano con consegna');
    const lomb = call({ id: 'lo', source: 'lombardia', title: 'Bando caffè consegna Milano' });
    const r = scoreCall(lomb, signals, NOW, idfOf([lomb]));
    expect(r.reasons.some((x) => x.kind === 'region' && x.label === 'Lombardia')).toBe(true);
  });

  it('a deadline inside 30 days adds urgency, a far one does not', () => {
    const signals = signalsFor('Piattaforma SaaS di carbon accounting per PMI manifatturiere');
    const soon = call({ id: 's', deadline: '2026-09-20', status: 'open' });
    const far = call({ id: 'f', deadline: '2027-09-20', status: 'open' });
    const idf = idfOf([soon, far]);
    expect(scoreCall(soon, signals, NOW, idf).score).toBeGreaterThan(scoreCall(far, signals, NOW, idf).score);
    expect(scoreCall(soon, signals, NOW, idf).reasons.some((r) => r.kind === 'closing')).toBe(true);
  });

  it('every point is attributable to a named reason', () => {
    const signals = signalsFor('SaaS di carbon accounting per PMI manifatturiere italiane');
    const c = call({
      id: 'x',
      facets: { subject_types: ['Impresa'], scopes: ['Digitalizzazione'], support_forms: [], ateco: null, national: true },
    });
    const r = scoreCall(c, signals, NOW, idfOf([c]));
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons.length).toBeGreaterThan(0);
    for (const reason of r.reasons) expect(reason.label.length).toBeGreaterThan(0);
  });
});

describe('ranking is deterministic and total', () => {
  const signals = signalsFor('SaaS di carbon accounting per PMI manifatturiere italiane');
  const calls = [
    call({ id: 'a', deadline: '2026-12-01', status: 'open', title: 'Zeta' }),
    call({ id: 'b', deadline: '2026-11-01', status: 'open', title: 'Alfa' }),
    call({ id: 'c', deadline: null, title: 'Beta' }),
  ];

  it('the same inputs always give the same order', () => {
    const one = rankCalls(calls, signals, NOW).map((c) => c.id);
    const two = rankCalls([...calls].reverse(), signals, NOW).map((c) => c.id);
    expect(one).toEqual(two);
  });

  it('ties fall back to deadline, nulls last', () => {
    const ranked = rankCalls(calls, signals, NOW);
    expect(ranked[ranked.length - 1].id).toBe('c');
  });

  it('keeps every call it was given', () => {
    expect(rankCalls(calls, signals, NOW)).toHaveLength(calls.length);
  });

  it('relevantOnly keeps a bare EU tag out of the shortlist', () => {
    const eu = call({ id: 'eu', source: 'sedia', title: 'Unrelated topic' });
    const ranked = rankCalls([eu], extractProjectSignals({ description: 'Gelateria artigianale a conduzione familiare' }), NOW);
    expect(relevantOnly(ranked)).toHaveLength(0);
  });
});

describe('the page can sort by relevance without losing the deadline view', () => {
  it('sortByRelevance puts the higher score first and treats missing scores as zero', () => {
    const a = { ...call({ id: 'a', deadline: '2027-01-01', status: 'open' }), relevance: { score: 5, reasons: [] } };
    const b = { ...call({ id: 'b', deadline: '2026-10-01', status: 'open' }), relevance: { score: 50, reasons: [] } };
    const c = call({ id: 'c', deadline: '2026-09-10', status: 'open' });
    expect(sortByRelevance([a, c, b]).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('applyFilters honours the sort mode', () => {
    const a = { ...call({ id: 'a', deadline: '2027-01-01', status: 'open' }), relevance: { score: 90, reasons: [] } };
    const b = { ...call({ id: 'b', deadline: '2026-10-01', status: 'open' }), relevance: { score: 1, reasons: [] } };
    expect(applyFilters([a, b], { chip: 'all', q: '', sort: 'relevance' }, NOW).map((x) => x.id)).toEqual(['a', 'b']);
    expect(applyFilters([a, b], { chip: 'all', q: '', sort: 'deadline' }, NOW).map((x) => x.id)).toEqual(['b', 'a']);
    // Default stays the deadline order the page has always shown.
    expect(applyFilters([a, b], { chip: 'all', q: '' }, NOW).map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('zero model calls — the whole point', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

  it('neither ranking module can reach a model, a network, or a database', () => {
    for (const f of ['src/lib/grants/project-signals.ts', 'src/lib/grants/relevance.ts']) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
      expect(src, f).not.toMatch(/from '@\/lib\/(db|llm|ai)/);
      expect(src, f).not.toMatch(/pi-ai|anthropic|openai|openrouter/i);
      expect(src, f).not.toMatch(/\basync\b/);
      // Imports are types and the sibling module only.
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        expect(m[1], `${f} imports ${m[1]}`).toMatch(/^\.\/(view|project-signals)$/);
      }
    }
  });

  it('the grants route ranks inline and adds no model call', () => {
    const route = read('src/app/api/projects/[projectId]/grants/route.ts');
    expect(route).toMatch(/extractProjectSignals\(/);
    expect(route).toMatch(/rankCalls\(/);
    expect(route).not.toMatch(/pi-ai|anthropic|streamSimple|runAgent/i);
  });
});
