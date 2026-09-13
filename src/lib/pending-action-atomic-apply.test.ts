import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, runMock, row } = vi.hoisted(() => ({
  queryMock: vi.fn(), runMock: vi.fn(),
  row: { id: 'pa_1', project_id: 'proj_1', status: 'pending', payload: {}, edited_payload: null as unknown },
}));
vi.mock('./db', () => ({ query: queryMock, run: runMock }));
vi.mock('./signal-autoflow', () => ({ isAutoflowEnabled: () => false, routeAlertAutoflow: vi.fn() }));
import { applyPendingAction, editPendingAction, canTransition, InvalidTransitionError, PendingActionChangedError } from './pending-actions';

beforeEach(() => {
  vi.clearAllMocks();
  row.status = 'pending';
  row.payload = {};
  row.edited_payload = null;
  queryMock.mockImplementation(async () => [{ ...row }]);
  runMock.mockImplementation(async (_sql: string, to: string, _now: string, edits: unknown, id: string, from: string, payload: unknown, previousEdits: unknown) => {
    if (row.id !== id || row.status !== from || JSON.stringify(row.payload) !== JSON.stringify(payload) || JSON.stringify(row.edited_payload) !== JSON.stringify(previousEdits)) return { count: 0 };
    row.status = to;
    row.edited_payload = edits;
    return { count: 1 };
  });
});

describe('atomic approval payload and execution claim', () => {
  it('allows the founder to skip a failed approval instead of requiring a retry', () => {
    expect(canTransition('failed', 'rejected')).toBe(true);
  });

  it('claims execution once and keeps the winning founder edits under concurrency', async () => {
    const first = { items: [{ value: 'First approved text' }] };
    const second = { items: [{ value: 'Other approved text' }] };
    const results = await Promise.allSettled([applyPendingAction('pa_1', first), applyPendingAction('pa_1', second)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof applyPendingAction>>>;
    expect(winner.value.edited_payload).toEqual(first);
    expect(row.edited_payload).toEqual(first);
    const loser = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(InvalidTransitionError);
    expect(runMock.mock.calls[0][0]).toContain('edited_payload = ?');
    expect(runMock.mock.calls[0][0]).toContain('WHERE id = ? AND status = ?');
  });

  it('can retry a failed action with revised text in the same claim', async () => {
    row.status = 'failed';
    const revised = { items: [{ value: 'Corrected' }] };
    expect((await applyPendingAction('pa_1', revised)).edited_payload).toEqual(revised);
    expect(row.status).toBe('applied');
  });

  it('rejects an approval when an automatic refresh changes a still-pending proposal after the read', async () => {
    queryMock.mockImplementationOnce(async () => {
      const snapshot = { ...row };
      row.payload = { items: [{ value: 'Changed while approving' }] };
      return [snapshot];
    });
    await expect(applyPendingAction('pa_1', { items: [{ value: 'Reviewed text' }] })).rejects.toBeInstanceOf(PendingActionChangedError);
    expect(row.status).toBe('pending');
    expect(row.edited_payload).toBeNull();
  });

  it('does not overwrite a competing edit when both requests started from edited status', async () => {
    row.status = 'edited';
    row.edited_payload = { value: 'Original' };
    const results = await Promise.allSettled([
      editPendingAction('pa_1', { value: 'First founder edit' }),
      editPendingAction('pa_1', { value: 'Second founder edit' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(PendingActionChangedError);
    expect(row.edited_payload).toEqual({ value: 'First founder edit' });
  });

  it('never changes the payload of a rejected or already sent proposal', async () => {
    for (const status of ['rejected', 'sent']) {
      row.status = status;
      await expect(applyPendingAction('pa_1', { items: [] })).rejects.toBeInstanceOf(InvalidTransitionError);
    }
    expect(runMock).not.toHaveBeenCalled();
  });
});
