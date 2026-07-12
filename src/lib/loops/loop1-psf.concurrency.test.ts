import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the Loop-1 concurrency hardening (2026-07-10 gap audit M1 + F8):
//  - escalateLoop1 claims the iteration bump atomically (optimistic lock on
//    the read iteration), so two concurrent interview writes can't chain
//    1→2→3 past the cap or stage duplicate re-proposal cards;
//  - overrideLoop1 records its loop1_override event ONLY when the UPDATE
//    landed — a no-op override (already-closed loop, orphan card, bogus id)
//    must not permanently suppress the auto-trigger.
// DB + heavy deps are mocked — no live DB.
const { getMock, runMock, queryMock, eventMock, snapMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
  queryMock: vi.fn(),
  eventMock: vi.fn(),
  snapMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: queryMock }));
vi.mock('@/lib/journey', () => ({
  buildProjectSnapshot: snapMock,
  evaluateAllStages: vi.fn(() => []),
  activeStage: vi.fn(),
}));
vi.mock('@/lib/journey/validation-targets', () => ({ validationTargetsFor: vi.fn(() => []) }));
vi.mock('@/lib/pending-actions', () => ({ createPendingAction: vi.fn(async () => ({ id: 'pa_x' })) }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: eventMock, lastEventOfType: vi.fn(async () => null) }));
vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveLocale: vi.fn(async () => 'en') }));
vi.mock('@/lib/i18n/messages', () => ({ translate: vi.fn((_l: string, k: string) => k) }));
vi.mock('@/lib/api-helpers', () => ({ generateId: vi.fn(() => 'loop_gen') }));

import { escalateLoop1, overrideLoop1, maybeTriggerLoop1 } from '@/lib/loops/loop1-psf';
import { evaluateAllStages } from '@/lib/journey';

const activeLoop = (iteration: number) => ({
  id: 'loop_1', project_id: 'proj_1', loop_number: 1, iteration,
  status: 'active', trigger: 'auto', loop_score: null, scope: null,
  verdict: null, pending_action_id: 'pa_1',
});

beforeEach(() => {
  vi.clearAllMocks();
  eventMock.mockResolvedValue(undefined);
  snapMock.mockResolvedValue({ interviews: [] });
});

describe('escalateLoop1 atomic claim (audit M1)', () => {
  it('bumps via iteration+1 guarded by the read iteration and escalates below the cap', async () => {
    getMock.mockResolvedValueOnce(activeLoop(1));
    runMock.mockResolvedValueOnce([{ iteration: 2 }]);
    const res = await escalateLoop1('proj_1');
    expect(res).toEqual({ atCap: false, iteration: 2 });
    const [sql, ...params] = runMock.mock.calls[0];
    expect(sql).toContain('iteration = iteration + 1');
    expect(sql).toContain('AND iteration = ?');
    expect(params).toEqual(['loop_1', 1]);
  });

  it('the race loser (0 rows claimed) no-ops instead of double-escalating', async () => {
    getMock.mockResolvedValueOnce(activeLoop(1));
    runMock.mockResolvedValueOnce([]); // a concurrent caller already claimed this round
    const res = await escalateLoop1('proj_1');
    expect(res).toBeNull();
    expect(runMock).toHaveBeenCalledTimes(1); // no in_review write, no snapshot build
    expect(snapMock).not.toHaveBeenCalled();
  });

  it('past the cap → in_review with a deterministic Evidence Matrix', async () => {
    getMock.mockResolvedValueOnce(activeLoop(2));
    runMock.mockResolvedValueOnce([{ iteration: 3 }]); // claim
    runMock.mockResolvedValueOnce([]);                 // in_review UPDATE
    const res = await escalateLoop1('proj_1');
    expect(res?.atCap).toBe(true);
    expect(res?.iteration).toBe(3);
    expect(res?.evidence?.interviews).toBe(0);
    expect(String(runMock.mock.calls[1][0])).toContain("'in_review'");
  });

  it('returns null when no loop is open', async () => {
    getMock.mockResolvedValueOnce(undefined);
    expect(await escalateLoop1('proj_1')).toBeNull();
    expect(runMock).not.toHaveBeenCalled();
  });
});

describe('maybeTriggerLoop1 decided-guard reads the loop ROW, not the event (lost-STOP re-nag)', () => {
  // The loop1_verdict event write is not transactional with the verdict
  // UPDATE. A recorded STOP whose event was lost must STILL suppress the
  // auto-trigger — the decision on validation_loops is the source of truth.
  const weakSnapshot = {
    interviews: Array.from({ length: 6 }, (_, i) => ({
      id: `iv${i}`, person_name: `P${i}`, top_pain: 'they lose hours',
      urgency: 'high', wtp_amount: i === 0 ? 50 : null,
    })),
  } as never;

  it('does not re-propose when a closed loop carries a verdict (event missing)', async () => {
    queryMock.mockResolvedValueOnce([{ owner_user_id: 'user_1' }]); // owner lookup
    vi.mocked(evaluateAllStages).mockReturnValue([
      { stage: { id: 'market_validation' }, status: 'done' },
    ] as never);
    getMock.mockResolvedValueOnce(undefined);            // openLoop1 → none
    getMock.mockResolvedValueOnce({ id: 'loop_closed' }); // decided check → STOP row exists
    await maybeTriggerLoop1('proj_1', weakSnapshot);
    expect(runMock).not.toHaveBeenCalled(); // no INSERT — decision honored
  });

  it('proposes when no prior decision exists on any loop row', async () => {
    queryMock.mockResolvedValueOnce([{ owner_user_id: 'user_1' }]);
    vi.mocked(evaluateAllStages).mockReturnValue([
      { stage: { id: 'market_validation' }, status: 'done' },
    ] as never);
    getMock.mockResolvedValueOnce(undefined); // openLoop1 → none
    getMock.mockResolvedValueOnce(undefined); // decided check → no verdict/override rows
    runMock.mockResolvedValue([]);
    await maybeTriggerLoop1('proj_1', weakSnapshot);
    expect(String(runMock.mock.calls[0][0])).toContain('INSERT INTO validation_loops');
  });
});

describe('overrideLoop1 event guard (audit F8)', () => {
  it('emits loop1_override only when the UPDATE landed', async () => {
    runMock.mockResolvedValueOnce([{ id: 'loop_1' }]);
    await overrideLoop1('proj_1', 'loop_1', 'user_1', 'motivation');
    expect(eventMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'loop1_override' }));
  });

  it('a no-op override (closed/nonexistent loop) records NO suppressing event', async () => {
    runMock.mockResolvedValueOnce([]);
    await overrideLoop1('proj_1', 'loop_gone', 'user_1', 'motivation');
    expect(eventMock).not.toHaveBeenCalled();
  });
});
