import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getMock, runMock } = vi.hoisted(() => ({ getMock: vi.fn(), runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: vi.fn() }));

import { getCachedResearch, putCachedResearch, normalizeResearchKey } from '@/lib/research-cache';

describe('normalizeResearchKey', () => {
  it('lowercases + collapses whitespace so trivial variants share a key', () => {
    expect(normalizeResearchKey('  Italian   Meal-Kit  MARKET ')).toBe('italian meal-kit market');
  });
});

describe('getCachedResearch', () => {
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  it('reconstructs an AgentToolResult on a fresh hit', async () => {
    getMock.mockResolvedValueOnce({ result_text: 'cached markdown', sources: [{ type: 'web', url: 'https://x.com', title: 'X' }] });
    const out = await getCachedResearch('web_search', 'k');
    expect((out?.content?.[0] as { text: string }).text).toBe('cached markdown');
    expect((out?.details as { cache_hit: boolean }).cache_hit).toBe(true);
    expect((out?.details as { sources: unknown[] }).sources).toHaveLength(1);
    // The query must gate on expiry.
    expect(String(getMock.mock.calls[0][0])).toContain('expires_at > CURRENT_TIMESTAMP');
  });

  it('returns null on a miss', async () => {
    getMock.mockResolvedValueOnce(undefined);
    expect(await getCachedResearch('web_search', 'k')).toBeNull();
  });

  it('degrades to null on a DB error', async () => {
    getMock.mockRejectedValueOnce(new Error('db down'));
    expect(await getCachedResearch('read_url', 'k')).toBeNull();
  });
});

describe('putCachedResearch — only caches successful, sourced results', () => {
  beforeEach(() => { getMock.mockReset(); runMock.mockReset(); });

  it('inserts when the result has text + sources', async () => {
    await putCachedResearch('web_search', 'k', {
      content: [{ type: 'text', text: 'body' }],
      details: { sources: [{ type: 'web', url: 'https://x.com', title: 'X' }] },
    } as never);
    expect(runMock).toHaveBeenCalledOnce();
    // sources bound RAW (array), never a JSON string (double-encode guard).
    const args = runMock.mock.calls[0];
    expect(Array.isArray(args[args.length - 1])).toBe(true);
  });

  it('no-ops on an error result', async () => {
    await putCachedResearch('web_search', 'k', { content: [{ type: 'text', text: 'x' }], details: { error: true, sources: [] } } as never);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('no-ops when there are no sources', async () => {
    await putCachedResearch('web_search', 'k', { content: [{ type: 'text', text: 'x' }], details: { sources: [] } } as never);
    expect(runMock).not.toHaveBeenCalled();
  });
});
