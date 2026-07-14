import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, runMock } = vi.hoisted(() => ({ queryMock: vi.fn(), runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: queryMock, run: runMock, get: vi.fn() }));

import { recordStageTransitions } from '@/lib/journey/stage-history';

// Minimal StageEvaluation fixtures (only the fields recordStageTransitions reads).
function stage(id: string, number: number, status: string, checks: Array<[string, boolean]>) {
  return {
    stage: { id, number, label: id, tagline: '', checks: [] },
    passed: checks.filter(([, p]) => p).length,
    total: checks.length,
    status,
    results: checks.map(([cid, passed]) => ({ check: { id: cid, label: cid, source: '' }, result: { passed } })),
  } as never;
}

describe('recordStageTransitions (gap 5)', () => {
  beforeEach(() => { queryMock.mockReset(); runMock.mockReset(); });

  it('suppresses the day-one baseline (no prior rows, all checks fail, later stages pending)', async () => {
    queryMock.mockResolvedValueOnce([]); // no prior events
    const evals = [
      stage('idea', 1, 'active', [['problem_defined', false], ['solution_sketched', false]]),
      stage('market', 2, 'pending', [['market_size', false]]),
    ];
    const n = await recordStageTransitions('p1', evals);
    expect(n).toBe(0);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('records a first-observation PASS (a check already green) but not the stage baseline', async () => {
    queryMock.mockResolvedValueOnce([]);
    const evals = [stage('idea', 1, 'active', [['problem_defined', true], ['solution_sketched', false]])];
    const n = await recordStageTransitions('p1', evals);
    expect(n).toBe(1); // only problem_defined=pass
    expect(runMock).toHaveBeenCalledOnce();
  });

  it('records a transition when a check flips fail→pass and a stage flips active→done', async () => {
    queryMock.mockResolvedValueOnce([
      { stage_id: 'idea', check_id: null, to_status: 'active' },
      { stage_id: 'idea', check_id: 'problem_defined', to_status: 'fail' },
    ]);
    const evals = [stage('idea', 1, 'done', [['problem_defined', true]])];
    const n = await recordStageTransitions('p1', evals);
    expect(n).toBe(2); // stage active→done + check fail→pass
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it('is idempotent — no change since last recompute inserts nothing', async () => {
    queryMock.mockResolvedValueOnce([
      { stage_id: 'idea', check_id: null, to_status: 'done' },
      { stage_id: 'idea', check_id: 'problem_defined', to_status: 'pass' },
    ]);
    const evals = [stage('idea', 1, 'done', [['problem_defined', true]])];
    const n = await recordStageTransitions('p1', evals);
    expect(n).toBe(0);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('degrades to 0 on a DB error (never throws)', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    const evals = [stage('idea', 1, 'done', [['problem_defined', true]])];
    await expect(recordStageTransitions('p1', evals)).resolves.toBe(0);
  });
});
