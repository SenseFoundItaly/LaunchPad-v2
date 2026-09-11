import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins the shared reject side-effects (2026-07-10 gap audit H1): EVERY reject
// entry point (Inbox route + chat dismiss_pending_actions) runs through
// rejectActionWithSideEffects, so a dismissed psf-review card must release its
// Loop-1 (§4 founder-first escape) no matter which door the founder used, and
// the preference fact must carry the non-counting 'approval_inbox' source
// (H3 — a rejection can never green a keyword-gated spine check).
const { rejectMock, dismissMock, overrideMock, factMock, eventMock, queryMock } = vi.hoisted(() => ({
  rejectMock: vi.fn(),
  dismissMock: vi.fn(),
  overrideMock: vi.fn(),
  factMock: vi.fn(),
  eventMock: vi.fn(),
  queryMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/pending-actions', () => ({ rejectPendingAction: rejectMock }));
vi.mock('@/lib/action-executors', () => ({ dismissAlertSource: dismissMock }));
vi.mock('@/lib/loops/loop1-psf', () => ({ overrideLoop1: overrideMock }));
vi.mock('@/lib/memory/facts', () => ({ recordFact: factMock }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: eventMock }));

import { rejectActionWithSideEffects } from '@/lib/reject-action';
import type { PendingAction } from '@/types';

const psfCard = {
  id: 'pa_1',
  project_id: 'proj_1',
  action_type: 'run_skill',
  title: 'PSF Review — willingness-to-pay is only 20%',
  status: 'pending',
  payload: { skill_id: 'psf-review', loop_id: 'loop_1', origin: 'loop1_auto' },
} as unknown as PendingAction;

beforeEach(() => {
  vi.clearAllMocks();
  rejectMock.mockImplementation(async (id: string) => ({ id, status: 'rejected' }));
  dismissMock.mockResolvedValue(undefined);
  overrideMock.mockResolvedValue(undefined);
  factMock.mockResolvedValue(undefined);
  eventMock.mockResolvedValue(undefined);
  queryMock.mockResolvedValue([{ owner_user_id: 'user_1' }]);
});

describe('rejectActionWithSideEffects (audit H1)', () => {
  it('releases Loop 1 when a loop-linked psf-review card is dismissed', async () => {
    await rejectActionWithSideEffects(psfCard, 'proceeding without the review');
    expect(overrideMock).toHaveBeenCalledWith(
      'proj_1', 'loop_1', 'user_1', 'proceeding without the review',
    );
    expect(rejectMock).toHaveBeenCalledWith('pa_1', 'proceeding without the review');
    expect(dismissMock).toHaveBeenCalledWith(psfCard);
  });

  it('uses the default motivation when no reason is given', async () => {
    await rejectActionWithSideEffects(psfCard, undefined);
    expect(overrideMock).toHaveBeenCalledWith(
      'proj_1', 'loop_1', 'user_1', 'Founder dismissed the PSF review and chose to proceed.',
    );
  });

  it('leaves non-loop cards alone (no phantom override)', async () => {
    await rejectActionWithSideEffects(
      { ...psfCard, action_type: 'configure_monitor', payload: {} } as unknown as PendingAction,
      'duplicate watcher',
    );
    expect(overrideMock).not.toHaveBeenCalled();
    expect(rejectMock).toHaveBeenCalled();
  });

  it('run_skill cards for OTHER skills do not touch Loop 1', async () => {
    await rejectActionWithSideEffects(
      { ...psfCard, payload: { skill_id: 'startup-scoring' } } as unknown as PendingAction,
      undefined,
    );
    expect(overrideMock).not.toHaveBeenCalled();
  });

  it('records the preference fact with the non-counting approval_inbox source (audit H3)', async () => {
    await rejectActionWithSideEffects(psfCard, 'no');
    expect(factMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'approval_inbox',
      kind: 'preference',
    }));
    expect(eventMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'action_rejected' }));
  });

  it('a failed loop release is non-fatal — the reject itself still succeeds', async () => {
    overrideMock.mockRejectedValueOnce(new Error('db down'));
    const updated = await rejectActionWithSideEffects(psfCard, 'x');
    expect(updated).toMatchObject({ id: 'pa_1', status: 'rejected' });
  });
});
