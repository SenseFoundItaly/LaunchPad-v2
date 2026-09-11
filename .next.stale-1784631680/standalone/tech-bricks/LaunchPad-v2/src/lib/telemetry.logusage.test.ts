import { describe, it, expect, vi, beforeEach } from 'vitest';

// REGRESSION GUARD for the strict-billing chat double-charge (audit 2026-06-30).
//
// Strict billing (founder decision 2026-06-26) = "1 message = 1 credit,
// everything else free." The per-USER credit pool (user_budgets) must be moved
// ONLY by the flat debitCredits('chat_message') in the chat route. recordUsage
// was made observational, but logUsageToDb — the path CHAT actually uses to log
// token cost — was missed and kept calling upsertUserMonthlyBudget, so every
// message charged the flat $0.20 PLUS its real token cost (~2+ credits, scaling
// with usage). This test fails if anyone re-introduces a user-pool write here.
//
// We mock the db layer (so no real INSERT runs) and the cost-meter module the
// function dynamically imports, then assert which accumulators get called.
const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ run: runMock, get: vi.fn(), query: vi.fn() }));

const { upsertMonthlyBudgetMock, upsertUserMonthlyBudgetMock, ownerUserIdMock } = vi.hoisted(() => ({
  upsertMonthlyBudgetMock: vi.fn(),
  upsertUserMonthlyBudgetMock: vi.fn(),
  ownerUserIdMock: vi.fn(),
}));
vi.mock('@/lib/cost-meter', () => ({
  upsertMonthlyBudget: upsertMonthlyBudgetMock,
  upsertUserMonthlyBudget: upsertUserMonthlyBudgetMock,
  ownerUserId: ownerUserIdMock,
}));

import { logUsageToDb } from '@/lib/telemetry';

const usage = { input_tokens: 1000, output_tokens: 500 };

describe('logUsageToDb — strict-billing pool isolation', () => {
  beforeEach(() => {
    runMock.mockReset().mockResolvedValue(undefined);
    upsertMonthlyBudgetMock.mockReset().mockResolvedValue(undefined);
    upsertUserMonthlyBudgetMock.mockReset().mockResolvedValue(undefined);
    ownerUserIdMock.mockReset().mockResolvedValue('user_owner');
  });

  it('accumulates real cost into project_budgets but NEVER the per-user credit pool', async () => {
    await logUsageToDb('proj_1', null, 'chat', 'anthropic', 'claude-sonnet', usage, 0.14, 1200);

    // Per-project $ accumulator (the /usage analytics page) still gets the cost.
    expect(upsertMonthlyBudgetMock).toHaveBeenCalledTimes(1);
    expect(upsertMonthlyBudgetMock).toHaveBeenCalledWith('proj_1', expect.any(String), 0.14);

    // The user pool must be untouched — that's debitCredits('chat_message') only.
    expect(upsertUserMonthlyBudgetMock).not.toHaveBeenCalled();
    // And we should not even resolve the owner for a pool write anymore.
    expect(ownerUserIdMock).not.toHaveBeenCalled();
  });

  it('always writes the llm_usage_logs audit row (real cost preserved for analytics)', async () => {
    await logUsageToDb('proj_1', null, 'chat', 'anthropic', 'claude-sonnet', usage, 0.14, 1200);
    expect(runMock).toHaveBeenCalledTimes(1); // the INSERT INTO llm_usage_logs
  });

  it('skips BOTH budget accumulators when cost is 0 (still logs the row)', async () => {
    await logUsageToDb('proj_1', null, 'chat', 'anthropic', 'claude-sonnet', usage, 0, 1200);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(upsertMonthlyBudgetMock).not.toHaveBeenCalled();
    expect(upsertUserMonthlyBudgetMock).not.toHaveBeenCalled();
  });
});
