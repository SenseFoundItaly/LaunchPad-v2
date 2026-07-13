import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock, queryMock, getMock } = vi.hoisted(() => ({ runMock: vi.fn(), queryMock: vi.fn(), getMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ run: runMock, query: queryMock, get: getMock }));
vi.mock('@/lib/api-helpers', () => ({ generateId: (p: string) => `${p}_x` }));

import { recordScoreHistory, getScoreHistory } from '@/lib/score-history';

describe('recordScoreHistory', () => {
  beforeEach(() => { runMock.mockReset(); getMock.mockReset(); getMock.mockResolvedValue(undefined); });

  it('skips a no-change point (same value as the last, 2dp) — sparkline noise guard', async () => {
    getMock.mockResolvedValueOnce({ overall_score: 7.10 });
    await recordScoreHistory('p1', 7.104, 'gauge-chart');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('appends when the score actually moved', async () => {
    getMock.mockResolvedValueOnce({ overall_score: 7.1 });
    await recordScoreHistory('p1', 7.4, 'gauge-chart');
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('appends a real (>0) scoring', async () => {
    await recordScoreHistory('p1', 7.1, 'startup-scoring', 'Focus on WTP');
    expect(runMock).toHaveBeenCalledOnce();
    const args = runMock.mock.calls[0];
    expect(String(args[0])).toContain('INSERT INTO score_history');
    expect(args[3]).toBe(7.1);
    expect(args[5]).toBe('startup-scoring');
  });

  it('skips 0 / non-finite scores (dimensions-only writes are not events)', async () => {
    await recordScoreHistory('p1', 0, 'gauge-chart');
    await recordScoreHistory('p1', NaN, 'gauge-chart');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('never throws on a DB error', async () => {
    runMock.mockRejectedValueOnce(new Error('db down'));
    await expect(recordScoreHistory('p1', 5, 's')).resolves.toBeUndefined();
  });
});

describe('getScoreHistory', () => {
  beforeEach(() => queryMock.mockReset());
  it('returns the trajectory oldest→newest', async () => {
    queryMock.mockResolvedValueOnce([{ overall_score: 5.2 }, { overall_score: 7.1 }]);
    const pts = await getScoreHistory('p1');
    expect(pts).toHaveLength(2);
    expect(String(queryMock.mock.calls[0][0])).toContain('ORDER BY created_at ASC');
  });
  it('degrades to [] on error', async () => {
    queryMock.mockRejectedValueOnce(new Error('x'));
    await expect(getScoreHistory('p1')).resolves.toEqual([]);
  });
});
