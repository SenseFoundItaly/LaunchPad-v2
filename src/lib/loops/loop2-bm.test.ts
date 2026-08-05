import { describe, it, expect, vi } from 'vitest';
import {
  computeLoop2Score, shouldTriggerLoop2, loop2Scope, buildLoop2EvidenceMatrix,
  LOOP2_LTVCAC_THRESHOLD, LOOP2_ITERATION_CAP, LOOP2_GATED_SKILLS,
} from './loop2-bm';
import type { ProjectSnapshot } from '@/lib/journey';
import * as journey from '@/lib/journey';

type UnitEcon = NonNullable<ProjectSnapshot['pricing_state']>['unit_econ'];

// shouldTriggerLoop2 gates on "is the Business Model stage (Stage 4) done?" via
// evaluateAllStages. Rather than hand-build a full 7-stage fixture we stub the
// stage-done result and feed unit economics directly — the logic under test is
// stage-done + LTV/CAC below the stress bar.
function stubBM(done: boolean) {
  vi.spyOn(journey, 'evaluateAllStages').mockReturnValue([
    { stage: { id: 'business_model' }, status: done ? 'done' : 'active' },
  ] as unknown as ReturnType<typeof journey.evaluateAllStages>);
}
const snapshotWith = (unit_econ: UnitEcon): ProjectSnapshot =>
  ({ pricing_state: { unit_econ } } as unknown as ProjectSnapshot);

describe('computeLoop2Score', () => {
  it('computes LTV:CAC and marks it failed below the 3× bar', () => {
    const { ltvCacRatio, signals } = computeLoop2Score({ ltv: 360, cac: 180 }); // 2.0×
    expect(ltvCacRatio).toBeCloseTo(2.0);
    const s = signals.find((x) => x.signal === 'ltv_cac_ratio')!;
    expect(s.threshold).toBe(LOOP2_LTVCAC_THRESHOLD);
    expect(s.passed).toBe(false);
  });
  it('passes LTV:CAC at/above 3×', () => {
    const { ltvCacRatio, signals } = computeLoop2Score({ ltv: 600, cac: 180 }); // 3.33×
    expect(ltvCacRatio).toBeGreaterThanOrEqual(3);
    expect(signals.find((x) => x.signal === 'ltv_cac_ratio')!.passed).toBe(true);
  });
  it('returns null ratio when unit economics are absent or CAC is zero (no divide-by-zero)', () => {
    expect(computeLoop2Score(null).ltvCacRatio).toBeNull();
    expect(computeLoop2Score({ ltv: 500 }).ltvCacRatio).toBeNull();      // no CAC
    expect(computeLoop2Score({ ltv: 500, cac: 0 }).ltvCacRatio).toBeNull(); // CAC 0
  });
  it('surfaces payback + margin as secondary signals', () => {
    const { signals } = computeLoop2Score({ ltv: 400, cac: 200, payback_months: 24, gross_margin: 0.4 });
    expect(signals.find((x) => x.signal === 'payback_months')!.passed).toBe(false); // 24 > 18
    expect(signals.find((x) => x.signal === 'gross_margin')!.passed).toBe(false);   // 0.4 < 0.5
  });
});

describe('shouldTriggerLoop2', () => {
  it('fires when the Business Model stage is done and LTV:CAC < 3×', () => {
    stubBM(true);
    expect(shouldTriggerLoop2(snapshotWith({ ltv: 360, cac: 180 }))).toBe(true); // 2.0×
  });
  it('does NOT fire when unit economics are healthy (≥3×)', () => {
    stubBM(true);
    expect(shouldTriggerLoop2(snapshotWith({ ltv: 720, cac: 180 }))).toBe(false); // 4.0×
  });
  it('does NOT fire while the Business Model stage is still open', () => {
    stubBM(false);
    expect(shouldTriggerLoop2(snapshotWith({ ltv: 360, cac: 180 }))).toBe(false);
  });
  it('does NOT fire when unit economics are absent (nothing to stress-test yet)', () => {
    stubBM(true);
    expect(shouldTriggerLoop2(snapshotWith(null))).toBe(false);
  });
});

describe('loop2Scope', () => {
  it('scopes the unit-economics + pricing checks (surgical revision, not a stage reset)', () => {
    const checkIds = loop2Scope().map((t) => t.check_id);
    expect(checkIds.length).toBeGreaterThan(0);
    // The weak-signal driver (LTV:CAC) must be in scope; so must the pricing levers.
    expect(checkIds).toContain('unit_econ_viable');
    expect(checkIds).toContain('anchor_set');
    // Never scopes an unrelated stage's check (e.g. Stage-2 market checks).
    expect(checkIds).not.toContain('trends_assessed');
  });
});

describe('buildLoop2EvidenceMatrix', () => {
  it('is deterministic and reports the held ratio + iterations', () => {
    const e1 = buildLoop2EvidenceMatrix({ ltv: 360, cac: 180, payback_months: 20 }, LOOP2_ITERATION_CAP + 1);
    const e2 = buildLoop2EvidenceMatrix({ ltv: 360, cac: 180, payback_months: 20 }, LOOP2_ITERATION_CAP + 1);
    expect(e1).toEqual(e2); // no LLM, no randomness
    expect(e1.ltv_cac_ratio).toBeCloseTo(2.0);
    expect(e1.iterations).toBe(LOOP2_ITERATION_CAP + 1);
    expect(e1.summary).toContain('2.0×');
  });
});

describe('LOOP2_GATED_SKILLS', () => {
  it('gates Phase-3 build/GTM skills, not the Phase-2 business skills Loop 1 gates', () => {
    expect(LOOP2_GATED_SKILLS.has('prototype-spec')).toBe(true);
    expect(LOOP2_GATED_SKILLS.has('gtm-strategy')).toBe(true);
    expect(LOOP2_GATED_SKILLS.has('business-model')).toBe(false); // that's Loop 1's gate
    expect(LOOP2_GATED_SKILLS.has('financial-model')).toBe(false);
  });
});


// ── Iteration Cycle signals 2 & 3, and the Loop-2 → Loop-1 bridge ────────────

import {
  pricingWtpDelta, runwayMonths, meanInterviewWtp, pricingInvalidatesLoop1,
  LOOP2_PRICING_WTP_DELTA_BAR, LOOP2_RUNWAY_MONTHS_BAR,
} from './loop2-bm';

function snapFor(over: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    idea_canvas: null, competitors: [], research: null, monitors: [], watch_sources: [],
    pricing_state: null, burn_rate: null, workflow: null, growth_loops: [], metrics: [],
    memory_facts: [], interviews: [], fundraising_round: null, investors: [],
    counts: { published_assets: 0, pending_actions: 0, knowledge_items: 0 },
    startup_score: null, ...over,
  } as ProjectSnapshot;
}
const iv = (n: number, wtp: number | null) =>
  Array.from({ length: n }, (_, i) => ({ id: `iv${i}`, person_name: `P${i}`, top_pain: null, wtp_amount: wtp, urgency: null }));
const priced = (anchor: number | null) =>
  ({ anchor_price: anchor, tiers: [], wtp: null, unit_econ: null, model: null }) as ProjectSnapshot['pricing_state'];

describe('pricing vs interviewed WTP (Loop-2 signal 2)', () => {
  it('measures the relative gap between anchor price and mean interviewed WTP', () => {
    expect(meanInterviewWtp(iv(2, 50))).toBe(50);
    // €100 anchor against €50 WTP = 100% gap.
    expect(pricingWtpDelta(snapFor({ pricing_state: priced(100), interviews: iv(3, 50) }))).toBe(1);
  });

  it('is SYMMETRIC — pricing far BELOW stated WTP is also a divergence', () => {
    // Underpricing is the same evidence problem: the model and the interviews
    // have parted company, just in the founder's favour.
    expect(pricingWtpDelta(snapFor({ pricing_state: priced(20), interviews: iv(3, 50) }))).toBe(0.6);
  });

  it('is NULL when either side is missing — no data is not a failing signal', () => {
    expect(pricingWtpDelta(snapFor({ pricing_state: priced(100) }))).toBeNull();          // no interviews
    expect(pricingWtpDelta(snapFor({ interviews: iv(3, 50) }))).toBeNull();               // no price
    expect(pricingWtpDelta(snapFor({ pricing_state: priced(100), interviews: iv(3, null) }))).toBeNull();
  });

  it('omits the signal entirely rather than emitting a false failure', () => {
    const { signals } = computeLoop2Score({ ltv: 300, cac: 100 }, snapFor());
    expect(signals.some((s) => s.signal === 'pricing_wtp_delta')).toBe(false);
    expect(signals.some((s) => s.signal === 'runway_months')).toBe(false);
  });
});

describe('runway (Loop-2 signal 3)', () => {
  it('is cash / burn, and null without both figures', () => {
    expect(runwayMonths(snapFor({ burn_rate: { monthly_burn: 10_000, cash_on_hand: 90_000 } }))).toBe(9);
    expect(runwayMonths(snapFor({ burn_rate: { monthly_burn: 0, cash_on_hand: 90_000 } }))).toBeNull();
    expect(runwayMonths(snapFor())).toBeNull();
  });

  it('fails below the 6-month conservative bar', () => {
    const { signals } = computeLoop2Score({ ltv: 300, cac: 100 },
      snapFor({ burn_rate: { monthly_burn: 10_000, cash_on_hand: 30_000 } }));
    const runway = signals.find((s) => s.signal === 'runway_months')!;
    expect(runway.value).toBe(3);
    expect(runway.threshold).toBe(LOOP2_RUNWAY_MONTHS_BAR);
    expect(runway.passed).toBe(false);
  });
});

describe('the Loop-2 → Loop-1 bridge', () => {
  it('flags Loop 1 partially invalid past the 40% bar', () => {
    // Spec: "se il pricing deve cambiare in modo significativo rispetto alla
    // WTP rilevata nel Loop 1, il sistema segnala che il Loop 1 è parzialmente
    // invalidato."
    expect(LOOP2_PRICING_WTP_DELTA_BAR).toBe(0.40);
    expect(pricingInvalidatesLoop1(snapFor({ pricing_state: priced(100), interviews: iv(3, 50) }))).toBe(true);
  });

  it('does NOT flag a price still close to the evidence', () => {
    // 30% gap — inside the bar, the WTP evidence still supports the model.
    expect(pricingInvalidatesLoop1(snapFor({ pricing_state: priced(65), interviews: iv(3, 50) }))).toBe(false);
  });

  it('never invalidates evidence when the delta cannot be computed', () => {
    // An ABSENT signal must not invalidate interviews the founder actually ran.
    expect(pricingInvalidatesLoop1(snapFor())).toBe(false);
    expect(pricingInvalidatesLoop1(snapFor({ pricing_state: priced(100) }))).toBe(false);
  });
});
