import { describe, it, expect } from 'vitest';
import {
  computeIRL, IRL_LADDER, IRL_MAX,
  IRL_WTP_BAR, IRL_LTV_CAC_BAR, type IrlEvidence,
} from './ladder';
import type { StageId } from '@/lib/journey/types';

/** Build evidence where a given set of stages are done, plus signal overrides. */
function ev(over: Partial<IrlEvidence> & { stagesDone?: StageId[]; tracks?: Array<'1A' | '1B' | '1C'> } = {}): IrlEvidence {
  const stagesDone = new Set(over.stagesDone ?? []);
  const tracks = new Set(over.tracks ?? []);
  return {
    stageDone: (id) => stagesDone.has(id),
    trackDone: (t) => tracks.has(t),
    hasScore: over.hasScore ?? false,
    wtpRate: over.wtpRate ?? null,
    ltvCacRatio: over.ltvCacRatio ?? null,
    conversionRate: over.conversionRate ?? null,
    activationRate: over.activationRate ?? null,
    addOns: over.addOns ?? new Set<string>(),
  };
}

describe('computeIRL — the climb', () => {
  it('0 when nothing is earned', () => {
    expect(computeIRL(ev()).level).toBe(0);
  });

  it('1 once Idea Canvas is done', () => {
    expect(computeIRL(ev({ stagesDone: ['idea_validation'] })).level).toBe(1);
  });

  it('2 with a score + Gate 1A/1B', () => {
    const e = ev({ stagesDone: ['idea_validation'], hasScore: true, tracks: ['1A', '1B'] });
    expect(computeIRL(e).level).toBe(2);
  });

  it('3 with Gate 1C + WTP at/above the 30% bar', () => {
    const e = ev({
      stagesDone: ['idea_validation'], hasScore: true, tracks: ['1A', '1B', '1C'],
      wtpRate: IRL_WTP_BAR,
    });
    expect(computeIRL(e).level).toBe(3);
  });

  it('4 with Business Model done + LTV:CAC at/above 3×', () => {
    const e = ev({
      stagesDone: ['idea_validation', 'business_model'], hasScore: true, tracks: ['1A', '1B', '1C'],
      wtpRate: 0.5, ltvCacRatio: IRL_LTV_CAC_BAR,
    });
    expect(computeIRL(e).level).toBe(4);
  });
});

describe('computeIRL — evidence gates, not verdict labels', () => {
  it('stays at 2 when WTP is below the 30% bar (a dismissed/failing Loop 1 earns no point)', () => {
    const e = ev({
      stagesDone: ['idea_validation'], hasScore: true, tracks: ['1A', '1B', '1C'],
      wtpRate: 0.17, // below bar — the exact "override ≠ point" case
    });
    expect(computeIRL(e).level).toBe(2);
  });

  it('stays at 3 when LTV:CAC is viable-but-weak (< 3×) — the BM stress band', () => {
    const e = ev({
      stagesDone: ['idea_validation', 'business_model'], hasScore: true, tracks: ['1A', '1B', '1C'],
      wtpRate: 0.5, ltvCacRatio: 2.0,
    });
    expect(computeIRL(e).level).toBe(3);
  });

  it('null signals never satisfy their gate (no data ≠ passing)', () => {
    const e = ev({ stagesDone: ['idea_validation'], hasScore: true, tracks: ['1A', '1B', '1C'], wtpRate: null });
    expect(computeIRL(e).level).toBe(2);
  });
});

describe('computeIRL — contiguity + ceiling', () => {
  it('is CONTIGUOUS: a broken lower gate caps the index even if higher evidence exists', () => {
    // Everything for level 4 EXCEPT Gate 1A/1B (level 2) → can't be > 1.
    const e = ev({
      stagesDone: ['idea_validation', 'business_model'],
      hasScore: true, tracks: ['1C'], // 1A/1B missing
      wtpRate: 0.5, ltvCacRatio: 5,
    });
    expect(computeIRL(e).level).toBe(1);
  });

  it('caps at 4 today: levels 5-9 need metric feeds / add-ons that null out', () => {
    const e = ev({
      stagesDone: ['idea_validation', 'business_model', 'build_launch'],
      hasScore: true, tracks: ['1A', '1B', '1C'],
      wtpRate: 0.6, ltvCacRatio: 5,
      // conversionRate / activationRate null, addOns empty
    });
    const r = computeIRL(e);
    expect(r.level).toBe(4);
    expect(r.nextKey).toBe('build_test_loop3'); // what to earn next
  });

  it('reaches 9 when every gate (incl. add-ons) holds', () => {
    const e = ev({
      stagesDone: ['idea_validation', 'business_model', 'build_launch'],
      hasScore: true, tracks: ['1A', '1B', '1C'],
      wtpRate: 0.6, ltvCacRatio: 5, conversionRate: 0.08, activationRate: 0.25,
      addOns: new Set(['gtm_orchestration', 'fundraising_readiness', 'operations']),
    });
    const r = computeIRL(e);
    expect(r.level).toBe(IRL_MAX);
    expect(r.nextKey).toBeNull();
  });
});

describe('ladder shape', () => {
  it('is exactly 9 contiguous levels', () => {
    expect(IRL_LADDER.map((l) => l.level)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(IRL_MAX).toBe(9);
  });
});
