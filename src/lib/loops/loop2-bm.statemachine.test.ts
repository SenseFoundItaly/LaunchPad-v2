import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the Loop-2 state machine (maybeTriggerLoop2 + escalateLoop2). DB + heavy
// deps are mocked — loop-core's REAL SQL logic runs against the mocked driver,
// so this covers both loop2-bm's orchestration and the shared core it calls.
const { getMock, runMock, queryMock, eventMock, snapMock, paMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
  queryMock: vi.fn(),
  eventMock: vi.fn(),
  snapMock: vi.fn(),
  paMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: queryMock }));
vi.mock('@/lib/journey', () => ({
  buildProjectSnapshot: snapMock,
  evaluateAllStages: vi.fn(() => [{ stage: { id: 'business_model' }, status: 'done' }]),
}));
vi.mock('@/lib/journey/validation-targets', () => ({ validationTargetsFor: vi.fn(() => []) }));
vi.mock('@/lib/pending-actions', () => ({ createPendingAction: paMock }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: eventMock }));
vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveLocale: vi.fn(async () => 'en') }));
vi.mock('@/lib/i18n/messages', () => ({ translate: vi.fn((_l: string, k: string) => k) }));
vi.mock('@/lib/api-helpers', () => ({ generateId: vi.fn(() => 'loop_gen') }));

import { maybeTriggerLoop2, escalateLoop2 } from '@/lib/loops/loop2-bm';

const snapWith = (ltv: number | null, cac: number | null) =>
  ({ pricing_state: { unit_econ: ltv == null ? {} : { ltv, cac } } });
const activeLoop2 = (iteration: number) => ({
  id: 'loop_2', project_id: 'proj_1', loop_number: 2, iteration,
  status: 'active', trigger: 'auto', loop_score: null, scope: null,
  verdict: null, pending_action_id: 'pa_1',
});

beforeEach(() => {
  vi.clearAllMocks();
  eventMock.mockResolvedValue(undefined);
  paMock.mockResolvedValue({ id: 'pa_x' });
});

describe('maybeTriggerLoop2 — fresh trigger', () => {
  it('BM done + LTV:CAC 2.0× (<3×) + no open loop → INSERT proposed loop 2 + review card + event', async () => {
    snapMock.mockResolvedValue(snapWith(360, 180)); // 2.0×
    getMock.mockResolvedValueOnce(undefined); // openLoop(2) → none
    queryMock.mockResolvedValueOnce([{ owner_user_id: 'user_1' }]); // owner
    getMock.mockResolvedValueOnce(undefined); // decided-check → not decided
    runMock.mockResolvedValueOnce([]); // INSERT
    runMock.mockResolvedValueOnce([]); // UPDATE link pending_action_id

    await maybeTriggerLoop2('proj_1');

    const insert = runMock.mock.calls.find((c) => String(c[0]).includes('INSERT INTO validation_loops'));
    expect(insert).toBeTruthy();
    expect(String(insert![0])).toContain(", 2, 1, 'proposed', 'auto',"); // loop_number 2, iteration 1
    expect(paMock).toHaveBeenCalledTimes(1);
    expect(paMock.mock.calls[0][0].payload).toMatchObject({ skill_id: 'business-model', origin: 'loop2_auto' });
    expect(eventMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'loop2_review_proposed' }));
  });

  it('does NOT trigger when unit economics are healthy (≥3×)', async () => {
    snapMock.mockResolvedValue(snapWith(720, 180)); // 4.0×
    getMock.mockResolvedValueOnce(undefined); // openLoop(2) → none
    queryMock.mockResolvedValueOnce([{ owner_user_id: 'user_1' }]);

    await maybeTriggerLoop2('proj_1');

    expect(runMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO validation_loops'))).toBe(false);
    expect(paMock).not.toHaveBeenCalled();
  });

  it('does NOT re-nag once the founder already decided (verdict/override row exists)', async () => {
    snapMock.mockResolvedValue(snapWith(360, 180)); // 2.0×
    getMock.mockResolvedValueOnce(undefined); // openLoop(2) → none
    queryMock.mockResolvedValueOnce([{ owner_user_id: 'user_1' }]);
    getMock.mockResolvedValueOnce({ id: 'loop_old' }); // decided-check → already decided

    await maybeTriggerLoop2('proj_1');

    expect(runMock.mock.calls.some((c) => String(c[0]).includes('INSERT INTO validation_loops'))).toBe(false);
  });

  it('guards cheaply: no unit econ AND no open loop → returns before the owner lookup', async () => {
    snapMock.mockResolvedValue(snapWith(null, null)); // ratio null
    getMock.mockResolvedValueOnce(undefined); // openLoop(2) → none

    await maybeTriggerLoop2('proj_1');

    expect(queryMock).not.toHaveBeenCalled(); // never reached the owner query
  });
});

describe('maybeTriggerLoop2 — open loop', () => {
  it('active loop + LTV:CAC recovered (≥3×) → closes the loop resolved', async () => {
    snapMock.mockResolvedValue(snapWith(600, 180)); // 3.33×
    getMock.mockResolvedValueOnce(activeLoop2(1)); // openLoop(2) → active
    queryMock.mockResolvedValueOnce([{ owner_user_id: 'user_1' }]);
    runMock.mockResolvedValueOnce([]); // UPDATE status='closed'

    await maybeTriggerLoop2('proj_1');

    const close = runMock.mock.calls.find((c) => String(c[0]).includes("status = 'closed'"));
    expect(close).toBeTruthy();
    expect(paMock).not.toHaveBeenCalled(); // recovery ≠ re-propose
  });
});

describe('escalateLoop2 atomic claim', () => {
  it('bumps iteration guarded by the read iteration and escalates below the cap', async () => {
    getMock.mockResolvedValueOnce(activeLoop2(1)); // openLoop(2)
    runMock.mockResolvedValueOnce([{ iteration: 2 }]); // claim
    const res = await escalateLoop2('proj_1');
    expect(res).toEqual({ atCap: false, iteration: 2 });
    const [sql, ...params] = runMock.mock.calls[0];
    expect(sql).toContain('iteration = iteration + 1');
    expect(sql).toContain('AND iteration = ?');
    expect(params).toEqual(['loop_2', 1]);
  });

  it('the race loser (0 rows claimed) no-ops instead of double-escalating', async () => {
    getMock.mockResolvedValueOnce(activeLoop2(1));
    runMock.mockResolvedValueOnce([]); // a concurrent caller claimed this round
    const res = await escalateLoop2('proj_1');
    expect(res).toBeNull();
    expect(snapMock).not.toHaveBeenCalled(); // no evidence build
  });

  it('past the cap → in_review with a deterministic Evidence Matrix', async () => {
    getMock.mockResolvedValueOnce(activeLoop2(2));
    runMock.mockResolvedValueOnce([{ iteration: 3 }]); // claim → past cap (2)
    snapMock.mockResolvedValue(snapWith(360, 180)); // 2.0×
    runMock.mockResolvedValueOnce([]); // in_review UPDATE
    const res = await escalateLoop2('proj_1');
    expect(res?.atCap).toBe(true);
    expect(res?.iteration).toBe(3);
    expect(res?.evidence?.ltv_cac_ratio).toBeCloseTo(2.0);
    expect(String(runMock.mock.calls[1][0])).toContain("'in_review'");
  });
});
