import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock, queryMock, getMock } = vi.hoisted(() => ({ runMock: vi.fn(), queryMock: vi.fn(), getMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ run: runMock, query: queryMock, get: getMock }));
vi.mock('@/lib/api-helpers', () => ({ generateId: (p: string) => `${p}_x` }));

import { recordScoreHistory, getScoreHistory } from '@/lib/score-history';
import { buildProjectSnapshot } from '@/lib/journey/snapshot';
import { VALIDATION_TRACK_1B } from '@/lib/journey/stage-2-market-validation';

describe('recordScoreHistory', () => {
  beforeEach(() => { runMock.mockReset(); queryMock.mockReset(); getMock.mockReset(); getMock.mockResolvedValue(undefined); });

  it('skips a no-change point (same value AND same source, 2dp) — sparkline noise guard', async () => {
    getMock.mockResolvedValueOnce({ overall_score: 7.10, source: 'gauge-chart' });
    await recordScoreHistory('p1', 7.104, 'gauge-chart');
    expect(runMock).not.toHaveBeenCalled();
  });

  it('appends when the SOURCE changed even at the same value — a kind change is an event', async () => {
    // 48h audit: a startup-scoring run landing on the same integer as the old
    // clarity run appended nothing, so GET /score kept labeling the fresh
    // Startup dimensions "Clarity Score". Same number, different scoring =
    // a row, or the headline lies about what it is.
    getMock.mockResolvedValueOnce({ overall_score: 78, source: 'clarity-scoring' });
    await recordScoreHistory('p1', 78, 'startup-scoring');
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('appends when the score actually moved', async () => {
    getMock.mockResolvedValueOnce({ overall_score: 7.1 });
    await recordScoreHistory('p1', 7.4, 'gauge-chart');
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('records a completed full rescore even when its result is unchanged', async () => {
    getMock.mockResolvedValueOnce({ overall_score: 70, source: 'startup-scoring' });
    await recordScoreHistory('p1', 70, 'startup-scoring', 'Reviewed the new technical evidence');
    expect(runMock).toHaveBeenCalledOnce();
    expect(runMock.mock.calls[0][3]).toBe(70);
    expect(runMock.mock.calls[0][5]).toBe('startup-scoring');
  });

  it('a same-score rerun closes the stale 1B gate through the persisted snapshot', async () => {
    const history = [{ overall_score: 70, source: 'startup-scoring', created_at: '2026-09-01T00:00:00Z' }];
    getMock.mockImplementation(async () => history.at(-1));
    runMock.mockImplementation(async (sql, _id, _projectId, overall_score, _recommendation, source) => {
      if (sql.includes('INSERT INTO score_history')) {
        history.push({ overall_score, source, created_at: '2026-09-03T00:00:00Z' });
      }
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM memory_facts')) return [{
        id: 'technical-evidence', content: 'A new vendor is required', kind: 'tech_dependency_fact',
        source_type: 'chat', created_at: '2026-09-02T00:00:00Z',
      }];
      if (sql.includes('FROM score_history') && sql.includes('ORDER BY created_at DESC')) return [history.at(-1)];
      return [];
    });
    const gate = VALIDATION_TRACK_1B.find((check) => check.id === 'startup_score_1b')!;
    expect(gate.evaluate(await buildProjectSnapshot('p1')).passed).toBe(false);

    await recordScoreHistory('p1', 70, 'startup-scoring');

    const rescoredSnapshot = await buildProjectSnapshot('p1');
    expect(rescoredSnapshot.last_full_scoring?.overall_score).toBe(70);
    expect(gate.evaluate(rescoredSnapshot).passed).toBe(true);
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
