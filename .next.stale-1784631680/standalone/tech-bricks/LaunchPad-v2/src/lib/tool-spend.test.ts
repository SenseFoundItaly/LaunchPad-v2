import { describe, it, expect, vi, beforeEach } from 'vitest';

// recordToolSpend writes llm_usage_logs (db) + a Langfuse span. Mock both so we
// assert WHICH paths bill and which are free, without touching a DB or Langfuse.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ run: runMock, get: vi.fn(), query: vi.fn() }));
const { logToLangfuseMock } = vi.hoisted(() => ({ logToLangfuseMock: vi.fn() }));
vi.mock('@/lib/telemetry', () => ({ logToLangfuse: logToLangfuseMock }));

import {
  classifyToolSpend,
  recordToolSpend,
  EXA_SEARCH_COST_USD,
  EXA_READ_COST_USD,
} from '@/lib/tool-spend';

describe('classifyToolSpend', () => {
  it('prices Exa search and read at the configured per-call defaults', () => {
    expect(classifyToolSpend('exa', 'web_search')).toEqual({ provider: 'exa', cost: EXA_SEARCH_COST_USD });
    expect(classifyToolSpend('exa', 'read_url')).toEqual({ provider: 'exa', cost: EXA_READ_COST_USD });
  });

  it('treats free fallbacks and unknown sources as non-billable (null)', () => {
    expect(classifyToolSpend('ddg-fallback', 'web_search')).toBeNull();
    expect(classifyToolSpend('raw-fallback', 'read_url')).toBeNull();
    expect(classifyToolSpend(undefined, 'web_search')).toBeNull();
    expect(classifyToolSpend('mystery-provider', 'web_search')).toBeNull();
  });

  it('bills Jina only when a key is configured (keyless = free, rate-limited)', () => {
    // JINA_BILLED is captured from process.env.JINA_API_KEY at module load.
    if (process.env.JINA_API_KEY) {
      expect(classifyToolSpend('jina', 'web_search')).not.toBeNull();
    } else {
      expect(classifyToolSpend('jina', 'web_search')).toBeNull();
    }
  });
});

describe('recordToolSpend', () => {
  beforeEach(() => {
    runMock.mockReset().mockResolvedValue(undefined);
    logToLangfuseMock.mockReset().mockResolvedValue(null);
  });

  it('logs a usage row + Langfuse span for a billable Exa call (cost passed through)', async () => {
    await recordToolSpend({ projectId: 'proj_1', step: 'chat' }, 'web_search', 'exa');
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(logToLangfuseMock).toHaveBeenCalledTimes(1);
    // logToLangfuse(ctx, usage, cost, latencyMs) — cost is the 3rd arg.
    expect(logToLangfuseMock.mock.calls[0][2]).toBe(EXA_SEARCH_COST_USD);
  });

  it('skips entirely on the free fallback path (no usage row, no span)', async () => {
    await recordToolSpend({ projectId: 'proj_1' }, 'web_search', 'ddg-fallback');
    expect(runMock).not.toHaveBeenCalled();
    expect(logToLangfuseMock).not.toHaveBeenCalled();
  });

  it('skips when there is no project to attribute the spend to', async () => {
    await recordToolSpend({}, 'web_search', 'exa');
    expect(runMock).not.toHaveBeenCalled();
    expect(logToLangfuseMock).not.toHaveBeenCalled();
  });
});
