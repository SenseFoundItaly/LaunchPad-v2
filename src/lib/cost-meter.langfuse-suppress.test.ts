import { describe, it, expect, vi, beforeEach } from 'vitest';

// REGRESSION GUARD for the double-tracing fix.
//
// Once pi-agent.ts opens a live, properly-nested Langfuse trace for a
// runAgent() call, recordUsage() must skip its OWN post-hoc flat trace for
// that same call (a `langfuseTraceId` on the input signals "already traced
// live") — otherwise every turn produced two disconnected traces for one
// logical unit of work. Crucially, this must be a telemetry-only guard: the
// llm_usage_logs audit row and the project_budgets accumulator (the billing
// path) must fire identically whether or not langfuseTraceId is present —
// this test fails if suppression ever leaks into the billing path.

const { runMock, queryMock, getMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  queryMock: vi.fn(),
  getMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ run: runMock, query: queryMock, get: getMock }));

const { logToLangfuseMock, estimateCostMock } = vi.hoisted(() => ({
  logToLangfuseMock: vi.fn().mockResolvedValue('flat_trace_id'),
  estimateCostMock: vi.fn(() => 0),
}));
vi.mock('@/lib/telemetry', () => ({
  logToLangfuse: logToLangfuseMock,
  estimateCost: estimateCostMock,
}));

import { recordUsage } from '@/lib/cost-meter';

const BUDGET_ROW = { id: 'bud_1', current_llm_usd: 0.1, warn_llm_usd: 1, cap_llm_usd: 10, cap_credits: 50, status: 'active' };
const usage = { input: 100, output: 50, cost: { total: 0.01 } } as any;

describe('recordUsage — Langfuse double-trace suppression', () => {
  beforeEach(() => {
    runMock.mockReset().mockResolvedValue(undefined);
    queryMock.mockReset().mockResolvedValue([BUDGET_ROW]);
    getMock.mockReset().mockResolvedValue(undefined); // no project owner row — ownerUserId() -> null
    logToLangfuseMock.mockClear();
  });

  it('skips logToLangfuse when the caller already has a live trace (langfuseTraceId set)', async () => {
    await recordUsage({
      project_id: 'proj_1',
      step: 'chat',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage,
      langfuseTraceId: 'trace_live_123',
    });

    expect(logToLangfuseMock).not.toHaveBeenCalled();
  });

  it('still logs a flat trace when there is no live trace (unchanged legacy behavior)', async () => {
    await recordUsage({
      project_id: 'proj_1',
      step: 'chat',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage,
    });

    expect(logToLangfuseMock).toHaveBeenCalledTimes(1);
  });

  it('billing path (llm_usage_logs INSERT + project_budgets upsert) is IDENTICAL regardless of langfuseTraceId', async () => {
    await recordUsage({
      project_id: 'proj_1',
      step: 'chat',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage,
      langfuseTraceId: 'trace_live_123',
    });
    const withTraceCalls = { run: runMock.mock.calls.length, query: queryMock.mock.calls.length };

    runMock.mockClear();
    queryMock.mockClear();

    await recordUsage({
      project_id: 'proj_1',
      step: 'chat',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage,
    });
    const withoutTraceCalls = { run: runMock.mock.calls.length, query: queryMock.mock.calls.length };

    expect(withTraceCalls).toEqual(withoutTraceCalls);
    // llm_usage_logs INSERT + project_budgets upsert INSERT = 2 run() calls either way.
    expect(withoutTraceCalls.run).toBe(2);
  });

  it('userId threads through to logToLangfuse when present (identity fix, not just suppression)', async () => {
    await recordUsage({
      project_id: 'proj_1',
      step: 'chat',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      usage,
      userId: 'user_42',
    });

    expect(logToLangfuseMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_42' }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
