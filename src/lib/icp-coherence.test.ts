import { describe, it, expect } from 'vitest';
import {
  icpCoherenceRate, icpCoherenceFails, ICP_COHERENCE_BAR,
  buildIcpJudgePrompt, parseIcpJudgeReply,
} from './icp-coherence';

/**
 * Iteration Cycle Loop-1 signal 3 — "Coerenza ICP … soglia < 60% match".
 *
 * The spec quantifies the bar and never defines the match, so the DESIGN is
 * what these lock: the rate is computed only over judged interviews, an
 * unjudged backlog is silence rather than failure, and a malformed model reply
 * is an absent judgement rather than a "no".
 */

const iv = (icp_match: boolean | null | undefined) => ({ id: 'x', icp_match });

describe('icpCoherenceRate', () => {
  it('is the share of MATCHING among JUDGED interviews', () => {
    expect(icpCoherenceRate([iv(true), iv(true), iv(false), iv(false)])).toBe(0.5);
    expect(icpCoherenceRate([iv(true), iv(true), iv(true)])).toBe(1);
  });

  it('SKIPS unjudged rows instead of counting them against the founder', () => {
    // The real prod case: 82 of 84 interviews carry a segment, none judged yet.
    // Counting null as "no match" would show 0% coherence on evidence the
    // founder actually gathered — a fabricated failure.
    expect(icpCoherenceRate([iv(true), iv(null), iv(undefined)])).toBe(1);
    expect(icpCoherenceRate([iv(true), iv(false), iv(null)])).toBe(0.5);
  });

  it('is NULL when nothing has been judged — missing, not negative', () => {
    expect(icpCoherenceRate([iv(null), iv(null)])).toBeNull();
    expect(icpCoherenceRate([])).toBeNull();
    expect(icpCoherenceRate(null)).toBeNull();
  });
});

describe('the 60% bar', () => {
  it('fails just below and passes exactly on it', () => {
    expect(ICP_COHERENCE_BAR).toBe(0.60);
    // 3 of 5 = 60% -> on the bar, passes.
    expect(icpCoherenceFails([iv(true), iv(true), iv(true), iv(false), iv(false)])).toBe(false);
    // 2 of 5 = 40% -> fails.
    expect(icpCoherenceFails([iv(true), iv(true), iv(false), iv(false), iv(false)])).toBe(true);
  });

  it('an unmeasurable signal never fails', () => {
    expect(icpCoherenceFails([iv(null)])).toBe(false);
    expect(icpCoherenceFails([])).toBe(false);
  });
});

describe('the judge prompt', () => {
  it('carries both sides and tells the model to ignore self-declaration', () => {
    const p = buildIcpJudgePrompt('Independent full-service restaurants, 1-3 locations', 'Busy parent — core ICP');
    expect(p).toContain('Independent full-service restaurants');
    expect(p).toContain('Busy parent');
    // The worst false positive in the real data: profile text asserting it IS
    // the ICP while contradicting it.
    expect(p.toLowerCase()).toContain('ignore any claim');
  });

  it('includes the role when there is one', () => {
    expect(buildIcpJudgePrompt('ICP', 'segment', 'Head of Ops')).toContain('Head of Ops');
    expect(buildIcpJudgePrompt('ICP', 'segment')).not.toContain('role:');
  });
});

describe('parseIcpJudgeReply', () => {
  it('reads strict JSON and JSON wrapped in prose', () => {
    expect(parseIcpJudgeReply('{"match":true,"reason":"pizzeria is a restaurant"}'))
      .toEqual({ match: true, reason: 'pizzeria is a restaurant' });
    expect(parseIcpJudgeReply('Sure!\n{"match":false,"reason":"fast food"}\n'))
      .toMatchObject({ match: false });
  });

  it('returns NULL on anything malformed — never a default "no match"', () => {
    // A parse failure must leave the row unjudged (retried later), not record a
    // miss. Defaulting to false would let a model outage quietly tank a real
    // founder's coherence rate.
    for (const bad of ['', 'no idea', '{"match":"yes"}', '{"reason":"x"}', '{oops']) {
      expect(parseIcpJudgeReply(bad), bad).toBeNull();
    }
  });

  it('truncates a rambling reason rather than rejecting the verdict', () => {
    const r = parseIcpJudgeReply(`{"match":true,"reason":"${'x'.repeat(500)}"}`);
    expect(r?.match).toBe(true);
    expect(r!.reason.length).toBeLessThanOrEqual(200);
  });
});
