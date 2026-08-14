import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Two Validation-Gate decisions the product could make on the server and never
 * on the screen (2026-08-14, re-checking the 04/08 changelog against main).
 *
 *  1. EARLY EXIT. POST /gate-verdict has always accepted STOP at any time —
 *     "a founder who has already decided the idea is dead must not be made to
 *     tick six more boxes". But the only surface that could send one is the
 *     chat card, and `maybeProposeGateVerdict` stages that card ONLY once every
 *     evidence check passes. So the guard was real and unreachable.
 *
 *  2. REOPEN. DELETE /gate-verdict has existed since #358 and restages the
 *     card since #416 — with no caller anywhere in the client. The
 *     `gate_verdict` check told a founder who pivoted to "make the call again"
 *     and a founder who stopped to "reopen the gate if you want to resume",
 *     pointing at nothing either time. A STOP was in practice irreversible.
 *
 * Both are §4 dead-ends, so both get a guard: an endpoint with no way in is
 * indistinguishable, to the founder, from a feature that does not exist.
 */

const { queryMock, runMock, evidenceMock } = vi.hoisted(() => ({
  queryMock: vi.fn(), runMock: vi.fn(), evidenceMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: runMock, get: vi.fn() }));
vi.mock('@/lib/auth/require-project-access', () => ({
  tryProjectAccess: vi.fn(async () => ({ ok: true, session: { userId: 'u1' } })),
}));
vi.mock('@/lib/journey/snapshot', () => ({ buildProjectSnapshot: vi.fn(async () => ({})) }));
vi.mock('@/lib/journey/stage-2-market-validation', () => ({ validationGateEvidenceComplete: evidenceMock }));
vi.mock('@/lib/loops/loop1-psf', () => ({ triggerLoop1Manual: vi.fn(async () => null) }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/irl/floor', () => ({ clearIrlFloor: vi.fn(async () => {}) }));
vi.mock('@/lib/gate-verdict', () => ({ maybeProposeGateVerdict: vi.fn(async () => false) }));

import { GET, POST } from '@/app/api/projects/[projectId]/gate-verdict/route';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const callGet = async () => {
  const res = await GET({} as never, { params: Promise.resolve({ projectId: 'proj_1' }) });
  const body = await res.json();
  return (body?.data ?? body)?.gate_verdict ?? null;
};

describe('GET /gate-verdict — the state the spine needs to pick an affordance', () => {
  beforeEach(() => { queryMock.mockReset(); runMock.mockReset(); });

  it('returns the recorded verdict', async () => {
    queryMock.mockResolvedValueOnce([{ gate_verdict: { verdict: 'PIVOT', scope: '1C', motivation: 'ICP is wrong' } }]);
    expect(await callGet()).toMatchObject({ verdict: 'PIVOT', scope: '1C' });
  });

  it('returns null when the project has no research row at all', async () => {
    // The common case — `research` is created opportunistically, which is the
    // same fact that made a bare UPDATE lose the verdict on 65/94 projects.
    queryMock.mockResolvedValueOnce([]);
    expect(await callGet()).toBeNull();
  });

  it('returns null for a row whose gate_verdict is NULL or malformed', async () => {
    queryMock.mockResolvedValueOnce([{ gate_verdict: null }]);
    expect(await callGet()).toBeNull();
    queryMock.mockResolvedValueOnce([{ gate_verdict: { verdict: 'MAYBE' } }]);
    expect(await callGet()).toBeNull();
  });

  it('degrades to null on a DB error instead of throwing', async () => {
    // The footer is secondary UI: a blip must cost the reopen link, never the
    // checklist it sits under.
    queryMock.mockRejectedValueOnce(new Error('db down'));
    expect(await callGet()).toBeNull();
  });
});

describe('the two decisions are reachable from the founder-facing spine', () => {
  const spine = read('src/components/canvas/SpineSection.tsx');

  it('the early exit POSTs a STOP with a motivation', () => {
    expect(spine).toMatch(/verdict: 'STOP', motivation/);
    // Content-Type is load-bearing: middleware 415s a mutating /api request
    // without it, and the failure would look like "nothing happened".
    expect(spine).toContain("'Content-Type': 'application/json'");
  });

  it('a cancelled prompt records nothing, and a too-short reason is refused client-side', () => {
    expect(spine).toMatch(/if \(answer === null\) return;/);
    expect(spine).toMatch(/motivation\.length < 3/);
  });

  it('the reopen calls DELETE — the endpoint that had no caller', () => {
    expect(spine).toMatch(/method: 'DELETE'/);
    expect(spine).toContain('gate.reopen-confirm');
  });

  it('the footer only renders on the stage that owns the decision', () => {
    expect(spine).toMatch(/results\.some\(\(r\) => r\.check\.id === 'gate_verdict'\)/);
  });

  it('which affordance shows is driven by the RECORDED verdict, not by check prose', () => {
    // `gate_verdict` is passed:false for "not decided", "pivoted" and "stopped"
    // alike; matching its gap sentence would break on a copy edit or in IT.
    expect(spine).toContain('useGateVerdict');
    expect(spine).toMatch(/gateVerdict \?/);
  });

  it('both writes refresh the surfaces a chat-recorded verdict refreshes', () => {
    expect(spine).toContain('lp-actions-changed');
    expect(spine).toContain('lp-skills-changed');
  });
});

describe('the new copy exists in BOTH locales', () => {
  const en = read('src/lib/i18n/messages/en.ts');
  // NOT `it` — that shadows vitest's own `it` and the file collects with zero
  // tests (silently green in a suite runner that tolerates empty files).
  const itMsgs = read('src/lib/i18n/messages/it.ts');

  it.each([
    'gate.exit-early', 'gate.exit-early-tip', 'gate.exit-confirm',
    'gate.reopen', 'gate.reopen-tip', 'gate.reopen-confirm',
    'gate.decision-recorded', 'gate.decision-failed',
  ])('%s is translated', (key) => {
    expect(en).toContain(`'${key}'`);
    expect(itMsgs).toContain(`'${key}'`);
  });

  it('the reopen confirmation names the verdict being cleared', () => {
    expect(en).toContain('{verdict}');
    expect(itMsgs).toContain('{verdict}');
  });
});

describe('the query-event bridge knows the new topic', () => {
  it("'gate-verdict' is invalidated by lp-actions-changed", () => {
    const bridge = read('src/lib/query-events.ts');
    // Listing a topic with no consumer is the documented anti-pattern here, so
    // the hook and the topic must ship together.
    expect(bridge).toContain("'gate-verdict'");
    expect(read('src/hooks/useGateVerdict.ts')).toContain("queryKey: ['gate-verdict', projectId]");
  });
});

/**
 * The hole the post-deploy walk found on 2026-08-14, live against prod data.
 *
 * The GO guard used to read `shouldProposeGateVerdict(s) || alreadyDecided`.
 * The second half was meant as an idempotent re-submit from a reloaded card,
 * but it never checked WHICH verdict was on record — so ANY verdict unlocked
 * GO. Surfacing the early exit made that reachable in one move: STOP with the
 * gate deliberately incomplete (§4), then GO, and the gate greens on evidence
 * nobody gathered — the exact invariant the product leads with.
 *
 * GO is now gated on the evidence ALONE.
 */
describe('GO is gated on evidence, never on a verdict already being on record', () => {
  const callPost = async (body: Record<string, unknown>) => {
    const req = { json: async () => body } as never;
    const res = await POST(req, { params: Promise.resolve({ projectId: 'proj_1' }) });
    return res.status;
  };

  beforeEach(() => {
    queryMock.mockReset(); runMock.mockReset(); evidenceMock.mockReset();
    queryMock.mockResolvedValue([{ owner_user_id: 'u1' }]);
    runMock.mockResolvedValue(undefined);
  });

  it('REGRESSION: an early STOP does not unlock GO on an incomplete gate', async () => {
    evidenceMock.mockReturnValue(false);
    expect(await callPost({ verdict: 'STOP', motivation: 'I am stopping here' })).toBe(200);
    expect(await callPost({ verdict: 'GO' })).toBe(409);
  });

  it('GO passes once the evidence is actually complete', async () => {
    evidenceMock.mockReturnValue(true);
    expect(await callPost({ verdict: 'GO' })).toBe(200);
  });

  it('a founder can still change PIVOT → GO when the evidence is in', async () => {
    // The case the old escape hatch existed for. It must keep working: the
    // fix narrows the guard to the evidence, it does not lock a decision in.
    evidenceMock.mockReturnValue(true);
    expect(await callPost({ verdict: 'PIVOT', motivation: 'ICP is wrong', scope: '1C' })).toBe(200);
    expect(await callPost({ verdict: 'GO' })).toBe(200);
  });

  it('PIVOT and STOP stay allowed at any time, with a reason', async () => {
    evidenceMock.mockReturnValue(false);
    expect(await callPost({ verdict: 'STOP', motivation: 'done with this' })).toBe(200);
    expect(await callPost({ verdict: 'PIVOT', motivation: 'market is wrong', scope: '1A' })).toBe(200);
    expect(await callPost({ verdict: 'STOP', motivation: 'no' })).toBe(400);
  });
});
