import { describe, it, expect, vi, beforeEach } from 'vitest';

// REGRESSION GUARD for the serverless trace-drop fix (audit 2026-06-30).
// logToLangfuse must AWAIT flushAsync() — not fire-and-forget flush() — so the
// trace is on the wire before the Netlify/OpenNext Lambda freezes on response
// return. This test fails if anyone reverts to the unawaited flush().

// getLangfuse() gates on LANGFUSE_SECRET_KEY (read at call time), so enable it.
process.env.LANGFUSE_SECRET_KEY = 'sk-test';
process.env.LANGFUSE_PUBLIC_KEY = 'pk-test';

const { traceMock, generationMock, flushMock, flushAsyncMock } = vi.hoisted(() => {
  const generationMock = vi.fn();
  const flushMock = vi.fn();
  const flushAsyncMock = vi.fn();
  const traceMock = vi.fn(() => ({ id: 'trace_123', generation: generationMock }));
  return { traceMock, generationMock, flushMock, flushAsyncMock };
});
vi.mock('langfuse', () => ({
  Langfuse: class {
    trace = traceMock;
    flush = flushMock;
    flushAsync = flushAsyncMock;
  },
}));
// logToLangfuse doesn't touch the DB, but importing telemetry pulls in db — stub it.
vi.mock('@/lib/db', () => ({ run: vi.fn(), get: vi.fn(), query: vi.fn() }));

import { logToLangfuse } from '@/lib/telemetry';

const ctx = { projectId: 'proj_1', step: 'chat', provider: 'anthropic' as const, model: 'claude-sonnet-4-6' };

describe('logToLangfuse — serverless flush reliability', () => {
  beforeEach(() => {
    traceMock.mockClear();
    generationMock.mockClear();
    flushMock.mockClear();
    flushAsyncMock.mockReset().mockResolvedValue(undefined);
  });

  it('awaits flushAsync() and never uses fire-and-forget flush()', async () => {
    const id = await logToLangfuse(ctx, { input_tokens: 100, output_tokens: 50 }, 0.01, 1200);
    expect(id).toBe('trace_123');
    expect(flushAsyncMock).toHaveBeenCalledTimes(1);
    expect(flushMock).not.toHaveBeenCalled();
  });

  it('still returns the trace id when flushAsync rejects (delivery failure is non-fatal)', async () => {
    flushAsyncMock.mockRejectedValueOnce(new Error('network'));
    const id = await logToLangfuse(ctx, { input_tokens: 1, output_tokens: 1 }, 0.001, 10);
    expect(id).toBe('trace_123');
  });
});
