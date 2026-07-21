import { describe, it, expect, vi, beforeEach } from 'vitest';

// persistScoreFromSummary needs only get/run; mock the DB so the force-flag
// behavior (founder RE-scores must refresh the stored score — the >0-exists
// guard silently dropped every second run) is pinned without a live DB.
const { getMock, runMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  runMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: vi.fn() }));

import { persistScoreFromSummary, persistArtifact } from '@/lib/artifact-persistence';
import type { Artifact } from '@/types/artifacts';

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
    // The score UPDATE is the first run; a score_history append (real >0 score)
    // follows — so 2 calls now, with the UPDATE first.
    const [sql, overall] = runMock.mock.calls[0];
    expect(String(sql)).toContain('UPDATE scores');
    expect(overall).toBe(72);
    expect(String(runMock.mock.calls[1][0])).toContain('INSERT INTO score_history');
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

// The startup-scoring result often renders as a score-card/radar-chart instead
// of a gauge; those persisters used to hard-code overall_score = 0, leaving the
// Stage-1 startup_scoring_baseline check permanently red (DeskMate 2026-07-21).
describe('score-card / radar-chart — overall-score baseline fill', () => {
  const ctx = { userId: 'u1', projectId: 'p1' };
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  it('a baseline-titled score-card fills overall_score on INSERT (normalized to 0-10)', async () => {
    getMock.mockResolvedValue(undefined);
    await persistArtifact(ctx, {
      type: 'score-card', id: 'a1', title: 'DeskMate — Baseline Startup Score',
      score: 68, maxScore: 100, sources: [],
    } as unknown as Artifact);
    const [sql, , overall] = runMock.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO scores');
    expect(overall).toBe(6.8);
    // A real >0 baseline also lands in score_history.
    expect(String(runMock.mock.calls[1][0])).toContain('INSERT INTO score_history');
  });

  it('a baseline-titled score-card UPDATEs overall_score over an existing junk-0 row', async () => {
    getMock.mockResolvedValue({ dimensions: {} });
    await persistArtifact(ctx, {
      type: 'score-card', id: 'a1', title: 'Punteggio complessivo del progetto',
      score: 6.8, sources: [],
    } as unknown as Artifact);
    const [sql, , overall] = runMock.mock.calls[0];
    expect(String(sql)).toContain('overall_score = ?');
    expect(overall).toBe(6.8);
  });

  it('a per-dimension score-card still leaves overall_score untouched', async () => {
    getMock.mockResolvedValue({ dimensions: {} });
    await persistArtifact(ctx, {
      type: 'score-card', id: 'a1', title: 'Team strength', score: 8, sources: [],
    } as unknown as Artifact);
    expect(String(runMock.mock.calls[0][0])).not.toContain('overall_score');
  });

  it('a baseline-titled radar-chart backfills overall_score from the dimension average', async () => {
    getMock.mockResolvedValue(undefined);
    await persistArtifact(ctx, {
      type: 'radar-chart', id: 'a1', title: 'Startup Score — baseline',
      data: [
        { subject: 'Market', value: 60, fullMark: 100 },
        { subject: 'Team', value: 80, fullMark: 100 },
      ],
      sources: [],
    } as unknown as Artifact);
    const [sql, , overall] = runMock.mock.calls[0];
    expect(String(sql)).toContain('INSERT INTO scores');
    expect(overall).toBe(7); // (6 + 8) / 2, fullMark-normalized to 0-10
  });

  it('a non-baseline radar-chart still inserts overall_score = 0', async () => {
    getMock.mockResolvedValue(undefined);
    await persistArtifact(ctx, {
      type: 'radar-chart', id: 'a1', title: 'Confronto competitor',
      data: [{ subject: 'Prezzo', value: 7 }],
      sources: [],
    } as unknown as Artifact);
    const [, , overall] = runMock.mock.calls[0];
    expect(overall).toBe(0);
  });
});
