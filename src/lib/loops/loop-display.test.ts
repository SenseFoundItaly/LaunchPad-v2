import { describe, it, expect } from 'vitest';
import {
  isOpenLoop, openLoopOf, loopNameKey, verdictPillKind,
  signalLabelKey, formatSignal, primaryFailingSignal, type LoopRow, type LoopSignal,
} from './loop-display';

const row = (over: Partial<LoopRow>): LoopRow => ({
  id: 'loop_x', loop_number: 1, iteration: 1, status: 'proposed', trigger: 'auto',
  loop_score: null, scope: null, verdict: null, verdict_evidence: null,
  override_motivation: null, pending_action_id: 'pa', created_at: '2026-01-01', closed_at: null,
  ...over,
});

describe('open-loop selection', () => {
  it('treats proposed/active/in_review as open, closed as not', () => {
    expect(isOpenLoop(row({ status: 'proposed' }))).toBe(true);
    expect(isOpenLoop(row({ status: 'active' }))).toBe(true);
    expect(isOpenLoop(row({ status: 'in_review' }))).toBe(true);
    expect(isOpenLoop(row({ status: 'closed' }))).toBe(false);
  });
  it('openLoopOf returns the first open loop, or null', () => {
    expect(openLoopOf([row({ status: 'closed' }), row({ id: 'l2', status: 'active' })])?.id).toBe('l2');
    expect(openLoopOf([row({ status: 'closed' })])).toBeNull();
    expect(openLoopOf(undefined)).toBeNull();
  });
});

describe('labels + pills', () => {
  it('maps known loop numbers to name keys, unknown to null', () => {
    expect(loopNameKey(1)).toBe('loop.name-1');
    expect(loopNameKey(2)).toBe('loop.name-2');
    expect(loopNameKey(9)).toBeNull();
  });
  it('maps verdicts to pill kinds (GO green, PIVOT/STOP warn)', () => {
    expect(verdictPillKind('GO')).toBe('ok');
    expect(verdictPillKind('PIVOT')).toBe('warn');
    expect(verdictPillKind('STOP')).toBe('warn');
    expect(verdictPillKind(null)).toBe('n');
  });
  it('maps known signals to label keys', () => {
    expect(signalLabelKey('wtp_rate')).toBe('loop.signal-wtp');
    expect(signalLabelKey('ltv_cac_ratio')).toBe('loop.signal-ltvcac');
    expect(signalLabelKey('unknown_thing')).toBeNull();
  });
});

describe('formatSignal', () => {
  it('formats rates as %, ratios as ×, months as mo', () => {
    expect(formatSignal('wtp_rate', 0.17)).toBe('17%');
    expect(formatSignal('gross_margin', 0.82)).toBe('82%');
    expect(formatSignal('ltv_cac_ratio', 2.0)).toBe('2.0×');
    expect(formatSignal('payback_months', 18)).toBe('18mo');
  });
});

describe('primaryFailingSignal', () => {
  const sig = (over: Partial<LoopSignal>): LoopSignal => ({ signal: 's', value: 0, threshold: 0, passed: true, ...over });
  it('returns the first FAILING signal (the trigger driver)', () => {
    const s = primaryFailingSignal([sig({ signal: 'a', passed: true }), sig({ signal: 'b', passed: false })]);
    expect(s?.signal).toBe('b');
  });
  it('falls back to the first signal when all pass, null when empty', () => {
    expect(primaryFailingSignal([sig({ signal: 'a' }), sig({ signal: 'b' })])?.signal).toBe('a');
    expect(primaryFailingSignal([])).toBeNull();
    expect(primaryFailingSignal(null)).toBeNull();
  });
});
