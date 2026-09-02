import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { syncMock } = vi.hoisted(() => ({ syncMock: vi.fn() }));
vi.mock('@/lib/grants/sync', () => ({ syncFundingCalls: syncMock }));

import { GET } from './route';

const RESULT = {
  sources: [
    { source: 'sedia', ok: true, skipped_gate: false, fetched: 369, inserted: 2, reopened: 0, closed_missing: 0, alerts_created: 0, partial: false, error: null },
    { source: 'lombardia', ok: true, skipped_gate: true, fetched: 0, inserted: 0, reopened: 0, closed_missing: 0, alerts_created: 0, partial: false, error: null },
    { source: 'incentivi', ok: true, skipped_gate: false, fetched: 659, inserted: 5, reopened: 0, closed_missing: 1, alerts_created: 0, partial: false, error: null },
  ],
  expired: 3,
  alerts_dismissed: 0,
};

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out;
}

describe('GET /api/cron/grants — streaming daily sync', () => {
  beforeEach(() => { syncMock.mockReset(); process.env.CRON_SECRET = 'test-secret'; });

  it('rejects a caller without the cron bearer', async () => {
    const res = await GET(new NextRequest('http://localhost/api/cron/grants'));
    expect(res.status).toBe(401);
    expect(syncMock).not.toHaveBeenCalled();
  });

  it('streams a started frame, then the result and a flat done frame', async () => {
    syncMock.mockResolvedValue(RESULT);
    const res = await GET(new NextRequest('http://localhost/api/cron/grants', { headers: { authorization: 'Bearer test-secret' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await readAll(res);
    expect(body).toContain('"started":true');
    expect(body).toContain('"result":');
    const done = body.match(/data: (\{"done":true[^\n]*\})/);
    expect(done).not.toBeNull();
    const frame = JSON.parse(done![1]);
    expect(frame).toMatchObject({ done: true, ok: true, sources_ran: 2, fetched: 1028, inserted: 7, alerts: 0, expired: 3, errors: null });
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('never leaves the stream open on a sync failure — emits a done frame with the error', async () => {
    syncMock.mockRejectedValue(new Error('DATABASE_URL is not set'));
    const res = await GET(new NextRequest('http://localhost/api/cron/grants', { headers: { authorization: 'Bearer test-secret' } }));
    const body = await readAll(res);
    const frame = JSON.parse(body.match(/data: (\{"done":true[^\n]*\})/)![1]);
    expect(frame.ok).toBe(false);
    expect(frame.errors).toMatch(/DATABASE_URL/);
  });
});
