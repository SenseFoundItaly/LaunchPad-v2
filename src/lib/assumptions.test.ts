import { describe, it, expect, vi, beforeEach } from 'vitest';

const { runMock, getMock, generateIdMock, runAgentMock, recordUsageMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  getMock: vi.fn(),
  generateIdMock: vi.fn((p: string) => `${p}_x`),
  runAgentMock: vi.fn(),
  recordUsageMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ query: vi.fn(), run: runMock, get: getMock }));
vi.mock('@/lib/api-helpers', () => ({ generateId: generateIdMock }));
vi.mock('@/lib/pi-agent', () => ({ runAgent: runAgentMock }));
vi.mock('@/lib/cost-meter', () => ({ recordAgentUsage: recordUsageMock }));
vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveLocale: () => 'en' }));

import { extractAssumptions } from '@/lib/assumptions';

const TWO_ASSUMPTIONS = JSON.stringify({
  assumptions: [
    { category: 'market', text: 'Founders will pay for validation', criticality: 'high', explicit: true },
    { category: 'user_behavior', text: 'Users complete onboarding', criticality: 'medium', explicit: false },
  ],
});

describe('extractAssumptions — idempotency', () => {
  beforeEach(() => {
    runMock.mockReset();
    getMock.mockReset();
    runAgentMock.mockReset();
    runAgentMock.mockResolvedValue({ text: TWO_ASSUMPTIONS, usage: {} });
    // MAX(number) probe returns 0 first, dup-check returns undefined by default.
    getMock.mockResolvedValue(undefined);
  });

  it('inserts both assumptions on a fresh registry', async () => {
    const res = await extractAssumptions('p1', 'some rich context about the idea and market');
    expect(res.inserted).toBe(2);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it('skips assumptions whose text already exists (re-run does not duplicate)', async () => {
    // MAX(number) probe → {max: 2}; then BOTH dup-checks find an existing row.
    getMock
      .mockResolvedValueOnce({ max: 2 }) // MAX(number)
      .mockResolvedValueOnce({ id: 'asm_1' }) // dup-check item 1 → exists
      .mockResolvedValueOnce({ id: 'asm_2' }); // dup-check item 2 → exists
    const res = await extractAssumptions('p1', 'same context re-submitted');
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(2);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('inserts only the new assumption when one already exists', async () => {
    getMock
      .mockResolvedValueOnce({ max: 1 }) // MAX(number)
      .mockResolvedValueOnce({ id: 'asm_1' }) // item 1 → exists → skip
      .mockResolvedValueOnce(undefined); // item 2 → new → insert
    const res = await extractAssumptions('p1', 'context with one new assumption');
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
