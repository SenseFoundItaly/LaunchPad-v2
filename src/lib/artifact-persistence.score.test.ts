import { describe, it, expect, vi, beforeEach } from 'vitest';

// persistScoreFromSummary needs only get/run; mock the DB so the force-flag
// behavior (founder RE-scores must refresh the stored score — the >0-exists
// guard silently dropped every second run) is pinned without a live DB.
const { getMock, runMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: vi.fn() }));

import { persistScoreFromSummary } from '@/lib/artifact-persistence';

const SUMMARY = 'Overall Score: 72/100\nMarket Opportunity: 65/100\nTeam: 80/100';

describe('persistScoreFromSummary — force flag (re-score refresh)', () => {
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  it('without force, an existing >0 score blocks the write (first-run guard)', async () => {
    getMock.mockResolvedValue({ overall_score: 57 });
    await expect(persistScoreFromSummary('p1', SUMMARY)).resolves.toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('with force, a second run UPDATEs overall/dimensions over the existing row', async () => {
    getMock.mockResolvedValue({ overall_score: 57 });
    await expect(persistScoreFromSummary('p1', SUMMARY, { force: true })).resolves.toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);
    const [sql, overall] = runMock.mock.calls[0];
    expect(String(sql)).toContain('UPDATE scores');
    expect(overall).toBe(72);
  });

  it('a junk zero-score row never blocks, even without force', async () => {
    getMock.mockResolvedValue({ overall_score: 0 });
    await expect(persistScoreFromSummary('p1', SUMMARY)).resolves.toBe(true);
    expect(String(runMock.mock.calls[0][0])).toContain('UPDATE scores');
  });

  it('no existing row → INSERT (unchanged first-run path)', async () => {
    getMock.mockResolvedValue(undefined);
    await expect(persistScoreFromSummary('p1', SUMMARY)).resolves.toBe(true);
    expect(String(runMock.mock.calls[0][0])).toContain('INSERT INTO scores');
  });

  it('force with an unparsable summary writes nothing', async () => {
    getMock.mockResolvedValue({ overall_score: 57 });
    await expect(persistScoreFromSummary('p1', 'no score here', { force: true })).resolves.toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });
});
