import { describe, it, expect, vi, beforeEach } from 'vitest';

// needsPhase0Scoring hits the DB (scores probe) and skill-prereqs (canvas
// gate). Mock both so the zero-score bypass fix is pinned without a live DB:
// a junk 0-score row (chat radar-chart artifacts insert these) must NOT
// suppress the Phase-0 scoring nudge.
const { queryMock, prereqsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  prereqsMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/skill-prereqs', () => ({ canvasRunPrereqs: prereqsMock }));

import { needsPhase0Scoring } from '@/lib/direction';

describe('needsPhase0Scoring — zero-score rows must not suppress the nudge', () => {
  beforeEach(() => { queryMock.mockReset(); prereqsMock.mockReset(); });

  it('the scores probe requires overall_score > 0 (zero rows filtered in SQL)', async () => {
    queryMock.mockResolvedValue([]);
    prereqsMock.mockResolvedValue({ blocking: [] });
    await needsPhase0Scoring('p1');
    expect(String(queryMock.mock.calls[0][0])).toContain('overall_score > 0');
  });

  it('TRUE for a zero-score-only project with the canvas core in place', async () => {
    queryMock.mockResolvedValue([]); // what the >0 probe returns when only a 0-score row exists
    prereqsMock.mockResolvedValue({ blocking: [] });
    await expect(needsPhase0Scoring('p1')).resolves.toBe(true);
  });

  it('FALSE once a real (>0) baseline row exists — no prereq check needed', async () => {
    queryMock.mockResolvedValue([{ project_id: 'p1' }]);
    await expect(needsPhase0Scoring('p1')).resolves.toBe(false);
    expect(prereqsMock).not.toHaveBeenCalled();
  });

  it('FALSE while canvas prereqs still block startup-scoring', async () => {
    queryMock.mockResolvedValue([]);
    prereqsMock.mockResolvedValue({ blocking: ['solution'] });
    await expect(needsPhase0Scoring('p1')).resolves.toBe(false);
  });

  it('degrades to FALSE on a DB error (never throws)', async () => {
    queryMock.mockRejectedValue(new Error('db down'));
    await expect(needsPhase0Scoring('p1')).resolves.toBe(false);
  });
});
