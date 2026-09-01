import { describe, it, expect, vi, beforeEach } from 'vitest';

// REGRESSION GUARD for the flat-trace → real-hierarchy upgrade.
//
// Before this change, every LLM sub-call inside an agent run got its own
// disconnected flat Langfuse trace (logged post-hoc by callers after runAgent
// returned an already-summed usage total). Now runAgent/runAgentStream open
// ONE trace per run, live, inside the agent.subscribe() event loop: tool
// calls become spans, each LLM sub-call becomes its own generation, both
// nested under the trace. This test drives a mocked pi-agent-core Agent
// through a synthetic event sequence and asserts:
//   - tracing OFF (no getLangfuse() client): zero trace/span/generation
//     calls, and the returned {text, usage, timedOut} shape is byte-identical
//     to what it was before live tracing existed (additive-only).
//   - tracing ON: exactly one trace(), one span() per tool call (closed via
//     .end() on the matching tool_execution_end), one generation() per
//     message_end-with-usage, and flushAsync() called exactly once at the
//     true end of the run — not once per event.

const FAKE_MODEL = { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Sonnet' };

const { subscribeHandlers, MockAgent } = vi.hoisted(() => {
  const subscribeHandlers: Array<(event: any) => void> = [];
  class MockAgent {
    state: { model?: unknown; tools?: unknown[]; systemPrompt?: string; messages?: unknown[] } = {};
    private handler: ((event: any) => void) | null = null;
    subscribe(cb: (event: any) => void) {
      this.handler = cb;
      subscribeHandlers.push(cb);
    }
    async prompt(_text: string) {
      // Synthetic agent loop: one tool call, then one LLM sub-call with usage.
      this.handler?.({ type: 'tool_execution_start', toolCallId: 'call_1', toolName: 'web_search', args: { q: 'x' } });
      this.handler?.({ type: 'tool_execution_end', toolCallId: 'call_1', toolName: 'web_search', result: { hits: 1 }, isError: false });
      this.handler?.({
        type: 'message_end',
        message: { role: 'assistant', usage: { input: 100, output: 50, cacheWrite: 0, cacheRead: 0, totalTokens: 150, cost: { total: 0.002 } } },
      });
    }
    async waitForIdle() {}
    abort() {}
  }
  return { subscribeHandlers, MockAgent };
});

vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: MockAgent }));
vi.mock('@earendil-works/pi-ai', () => ({
  streamSimple: vi.fn(),
  getModel: vi.fn(() => FAKE_MODEL),
  getEnvApiKey: vi.fn(() => 'test-key'),
}));
vi.mock('@/lib/pi-tools', () => ({ getTools: vi.fn(() => []) }));
vi.mock('@/lib/llm/router', () => ({ pickModel: vi.fn(() => ({ provider: 'anthropic', model: 'claude-sonnet-4-6' })) }));

const {
  getLangfuseMock, estimateCostMock, mapToLangfuseModelIdMock, toLangfuseUsageAndCostMock,
  traceMock, spanMock, spanEndMock, generationMock, traceUpdateMock, flushAsyncMock,
} = vi.hoisted(() => {
  const spanEndMock = vi.fn();
  const spanMock = vi.fn(() => ({ end: spanEndMock }));
  const generationMock = vi.fn();
  const traceUpdateMock = vi.fn();
  const traceMock = vi.fn(() => ({ id: 'trace_abc', span: spanMock, generation: generationMock, update: traceUpdateMock }));
  const flushAsyncMock = vi.fn().mockResolvedValue(undefined);
  const getLangfuseMock = vi.fn();
  const estimateCostMock = vi.fn(() => 0.001);
  const mapToLangfuseModelIdMock = vi.fn((m: string) => m);
  const toLangfuseUsageAndCostMock = vi.fn((usage: any, cost: number) => ({
    usageDetails: { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, total: (usage.input_tokens || 0) + (usage.output_tokens || 0) },
    costDetails: cost > 0 ? { total: cost } : undefined,
  }));
  return {
    getLangfuseMock, estimateCostMock, mapToLangfuseModelIdMock, toLangfuseUsageAndCostMock,
    traceMock, spanMock, spanEndMock, generationMock, traceUpdateMock, flushAsyncMock,
  };
});

vi.mock('@/lib/telemetry', () => ({
  getLangfuse: getLangfuseMock,
  estimateCost: estimateCostMock,
  mapToLangfuseModelId: mapToLangfuseModelIdMock,
  toLangfuseUsageAndCost: toLangfuseUsageAndCostMock,
}));

// fs is used for session persistence (cleanStaleSessions/loadSession/appendToSession);
// no sessionId is passed in these tests, so keep it a harmless no-op.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => ''),
  appendFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(),
  rmSync: vi.fn(),
}));

import { runAgent } from '@/lib/pi-agent';

describe('runAgent — live Langfuse tracing', () => {
  beforeEach(() => {
    subscribeHandlers.length = 0;
    traceMock.mockClear();
    spanMock.mockClear();
    spanEndMock.mockClear();
    generationMock.mockClear();
    traceUpdateMock.mockClear();
    flushAsyncMock.mockClear();
    getLangfuseMock.mockReset();
  });

  it('tracing OFF: no trace/span/generation calls, result shape unaffected', async () => {
    getLangfuseMock.mockReturnValue(null); // LANGFUSE_SECRET_KEY unset — the existing no-op gate

    const result = await runAgent('hello');

    expect(traceMock).not.toHaveBeenCalled();
    expect(spanMock).not.toHaveBeenCalled();
    expect(generationMock).not.toHaveBeenCalled();
    expect(flushAsyncMock).not.toHaveBeenCalled();

    // Additive-only: usage accumulation and text are untouched by tracing being off.
    expect(result.text).toBe('');
    expect(result.timedOut).toBe(false);
    expect(result.usage).toMatchObject({ input: 100, output: 50 });
    expect(result.langfuseTraceId).toBeFalsy();
  });

  it('tracing ON: one trace, one span per tool call, one generation per sub-call usage, flush exactly once', async () => {
    getLangfuseMock.mockReturnValue({ trace: traceMock, flushAsync: flushAsyncMock });

    const result = await runAgent('hello', { projectId: 'proj_1', step: 'chat', userId: 'user_1', traceName: 'chat-turn' });

    expect(traceMock).toHaveBeenCalledTimes(1);
    expect(traceMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'chat-turn',
      userId: 'user_1',
      input: 'hello',
    }));

    // One span opened for the single tool call, closed via .end() with the
    // real result and isError — not just a bare close.
    expect(spanMock).toHaveBeenCalledTimes(1);
    expect(spanMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'web_search' }));
    expect(spanEndMock).toHaveBeenCalledTimes(1);
    expect(spanEndMock).toHaveBeenCalledWith(expect.objectContaining({ level: 'DEFAULT' }));

    // One generation for the one message_end-with-usage event.
    expect(generationMock).toHaveBeenCalledTimes(1);
    expect(generationMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'anthropic generation' }));

    // Root output set once, flush awaited exactly once at the true end — not
    // once per event (there were 3 events above).
    expect(traceUpdateMock).toHaveBeenCalledTimes(1);
    expect(flushAsyncMock).toHaveBeenCalledTimes(1);

    expect(result.langfuseTraceId).toBe('trace_abc');
    // Tracing being on must not change the accumulated usage/text contract.
    expect(result.usage).toMatchObject({ input: 100, output: 50 });
  });

  it('a tool span open/close or generation failure never breaks the run (non-fatal, matches try/catch contract elsewhere in this file)', async () => {
    getLangfuseMock.mockReturnValue({ trace: traceMock, flushAsync: flushAsyncMock });
    spanMock.mockImplementationOnce(() => { throw new Error('span boom'); });

    const result = await runAgent('hello', { projectId: 'proj_1' });

    // The run still completes and returns real usage despite the span failure.
    expect(result.text).toBe('');
    expect(result.usage).toMatchObject({ input: 100, output: 50 });
  });
});
