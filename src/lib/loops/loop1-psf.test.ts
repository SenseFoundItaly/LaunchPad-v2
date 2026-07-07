import { describe, it, expect, vi } from 'vitest';
import {
  computeLoop1Score, shouldTriggerLoop1, loop1Scope, buildEvidenceMatrix,
  LOOP1_WTP_THRESHOLD, LOOP1_MIN_INTERVIEWS, LOOP1_ITERATION_CAP,
  type Interview,
} from './loop1-psf';
import type { ProjectSnapshot } from '@/lib/journey';
import * as journey from '@/lib/journey';

const iv = (over: Partial<Interview> = {}): Interview => ({
  id: 'i_' + Math.random().toString(36).slice(2, 8),
  person_name: 'X', top_pain: 'lose hours', wtp_amount: null, urgency: 'high', ...over,
});

// shouldTriggerLoop1 gates on "is the Validation Gate (Stage 2) done?" via
// evaluateAllStages. That evaluator touches every stage's snapshot fields, so
// rather than hand-build a 7-stage fixture we stub the gate-done result and
// feed interviews directly — the logic under test is floor + WTP + gate-done.
function stubGate(done: boolean) {
  vi.spyOn(journey, 'evaluateAllStages').mockReturnValue([
    { stage: { id: 'market_validation' }, status: done ? 'done' : 'active' },
  ] as unknown as ReturnType<typeof journey.evaluateAllStages>);
}
const snapshotWith = (interviews: Interview[]): ProjectSnapshot =>
  ({ interviews } as unknown as ProjectSnapshot);

describe('computeLoop1Score', () => {
  it('computes the WTP rate and marks it failed below 30%', () => {
    const interviews = [iv({ wtp_amount: 20 }), iv(), iv(), iv(), iv(), iv(), iv(), iv()]; // 1/8 = 12.5%
    const { wtpRate, signals } = computeLoop1Score(interviews);
    expect(wtpRate).toBeCloseTo(0.125);
    const wtp = signals.find((s) => s.signal === 'wtp_rate')!;
    expect(wtp.threshold).toBe(LOOP1_WTP_THRESHOLD);
    expect(wtp.passed).toBe(false);
  });
  it('passes WTP at/above 30%', () => {
    const interviews = [iv({ wtp_amount: 10 }), iv({ wtp_amount: 10 }), iv({ wtp_amount: 10 }), iv(), iv()]; // 3/5 = 60%
    expect(computeLoop1Score(interviews).signals.find((s) => s.signal === 'wtp_rate')!.passed).toBe(true);
  });
  it('empty interviews → 0 rate, no divide-by-zero', () => {
    expect(computeLoop1Score([]).wtpRate).toBe(0);
  });
});

describe('shouldTriggerLoop1', () => {
  it('fires when the gate is done, ≥5 interviews, and WTP < 30%', () => {
    stubGate(true);
    const interviews = Array.from({ length: 8 }, (_, i) => iv({ wtp_amount: i === 0 ? 15 : null })); // 1/8
    expect(shouldTriggerLoop1(snapshotWith(interviews))).toBe(true);
  });
  it('does NOT fire below the interview floor', () => {
    stubGate(true);
    const interviews = Array.from({ length: LOOP1_MIN_INTERVIEWS - 1 }, () => iv({ wtp_amount: null }));
    expect(shouldTriggerLoop1(snapshotWith(interviews))).toBe(false);
  });
  it('does NOT fire when WTP is healthy (≥30%)', () => {
    stubGate(true);
    const interviews = Array.from({ length: 6 }, (_, i) => iv({ wtp_amount: i < 3 ? 10 : null })); // 3/6 = 50%
    expect(shouldTriggerLoop1(snapshotWith(interviews))).toBe(false);
  });
  it('does NOT fire while the Validation Gate is still open', () => {
    stubGate(false);
    const interviews = Array.from({ length: 8 }, () => iv({ wtp_amount: null }));
    expect(shouldTriggerLoop1(snapshotWith(interviews))).toBe(false);
  });
});

describe('loop1Scope', () => {
  it('scopes exactly ICP + value proposition + problem (surgical, not a reset)', () => {
    const checks = loop1Scope().map((t) => t.check_id);
    expect(checks).toContain('segment_named');       // ICP (target_market)
    expect(checks).toContain('problem_defined');
    // A small delta set (ICP + value prop + problem across the stages those
    // canvas fields gate) — surgical, not a whole-stage reset.
    expect(checks.length).toBeLessThanOrEqual(6);
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('buildEvidenceMatrix', () => {
  it('produces a structured, reproducible verdict brief at the cap', () => {
    const interviews = Array.from({ length: 10 }, (_, i) => iv({ wtp_amount: i < 2 ? 10 : null, top_pain: i < 6 ? 'pain' : null }));
    const m = buildEvidenceMatrix(interviews, LOOP1_ITERATION_CAP + 1);
    expect(m.wtp_rate).toBeCloseTo(0.2);
    expect(m.interviews).toBe(10);
    expect(m.iterations).toBe(LOOP1_ITERATION_CAP + 1);
    expect(m.signals.length).toBe(3);
    expect(m.summary).toMatch(/20%/);
  });
});
