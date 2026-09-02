import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PATCH /monitors/[monitorId] is the write path behind the grants page's
 * Inbox-alerts toggle. src/middleware.ts lets unauthenticated /api/* requests
 * through on purpose (each route 401s itself), so the gate MUST live here —
 * without it anyone holding a (projectId, monitorId) pair could pause any
 * project's grants watcher or rewrite its prompt. GET and POST in the same
 * file already gate; this pins PATCH to the same contract.
 */

const { queryMock, runMock, accessMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  runMock: vi.fn(),
  accessMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: runMock, get: vi.fn() }));
vi.mock('@/lib/auth/require-project-access', () => ({ tryProjectAccess: accessMock }));
vi.mock('@/lib/monitor-schedule', () => ({ calculateNextRun: vi.fn(() => '2026-09-03T06:00:00.000Z') }));
vi.mock('@/lib/action-executors', () => ({ buildMonitorScanPrompt: vi.fn(async () => 'prompt') }));
vi.mock('@/lib/monitor-run-stream', () => ({ streamMonitorRun: vi.fn() }));

import { PATCH } from '@/app/api/projects/[projectId]/monitors/[monitorId]/route';

const params = Promise.resolve({ projectId: 'proj_1', monitorId: 'mon_1' });
const patch = (body: unknown) =>
  PATCH(
    new Request('http://localhost/api/projects/proj_1/monitors/mon_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params },
  );

describe('PATCH /monitors/[monitorId] — project-access gate', () => {
  beforeEach(() => {
    queryMock.mockReset();
    runMock.mockReset();
    accessMock.mockReset();
  });

  it('returns the auth response and never touches the DB when access is denied', async () => {
    accessMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await patch({ status: 'paused' });

    expect(res.status).toBe(401);
    expect(accessMock).toHaveBeenCalledWith('proj_1');
    expect(queryMock).not.toHaveBeenCalled();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('still forwards 403 for a non-member, before body validation', async () => {
    accessMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    });

    // An invalid body would otherwise 400 — the gate must answer first.
    const res = await patch({ status: 'not-a-status' });

    expect(res.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('updates the watcher for a member of the project', async () => {
    accessMock.mockResolvedValueOnce({ ok: true, session: { userId: 'u1', projectId: 'proj_1' } });
    const existing = { id: 'mon_1', project_id: 'proj_1', schedule: 'daily', status: 'active', type: 'ecosystem.grants' };
    queryMock
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([{ ...existing, status: 'paused', next_run: null }]);
    runMock.mockResolvedValueOnce(undefined);

    const res = await patch({ status: 'paused' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('paused');
    expect(runMock).toHaveBeenCalledTimes(1);
    const [sql, ...values] = runMock.mock.calls[0];
    expect(sql).toMatch(/UPDATE monitors SET .* WHERE id = \? AND project_id = \?/);
    expect(values.slice(-2)).toEqual(['mon_1', 'proj_1']);
  });
});
