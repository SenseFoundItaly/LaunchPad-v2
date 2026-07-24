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
