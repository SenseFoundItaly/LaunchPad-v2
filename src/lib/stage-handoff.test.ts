import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Changelog 05/09 item 5 — "Al termine dello stage Idea Canvas manca un
 * messaggio in chat che guida l'utente al prossimo stage."
 *
 * The spine went green and the chat said nothing. The founder had just finished
 * the one stage the product walks them through step by step, and the reward was
 * silence: no acknowledgement, no next move, no way to tell whether finishing
 * had registered. What to do next existed — in a side panel they had no reason
 * to look at in that moment.
 */

const { queryMock, runMock, snapshotMock, activeStageMock } = vi.hoisted(() => ({
  queryMock: vi.fn(), runMock: vi.fn(), snapshotMock: vi.fn(), activeStageMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: runMock, get: vi.fn() }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveLocale: vi.fn(async () => 'it') }));
vi.mock('@/lib/journey', () => ({
  buildProjectSnapshot: snapshotMock,
  activeStageFor: activeStageMock,
}));

import { maybeProposeStageHandoff, HANDOFF_FROM_STAGES } from './stage-handoff';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const cardContent = () => String(runMock.mock.calls[0][3]);

describe('the handoff fires exactly when a stage closes', () => {
  beforeEach(() => {
    for (const m of [queryMock, runMock, snapshotMock, activeStageMock]) m.mockReset();
    queryMock.mockImplementation(async (sql: string) =>
      sql.includes('chat_messages') ? [] : [{ owner_user_id: 'u1' }]);
    snapshotMock.mockResolvedValue({});
    activeStageMock.mockReturnValue({ stage: { number: 2 } });
    runMock.mockResolvedValue(undefined);
  });

  it('announces Stage 1 and offers the first moves of Stage 2', async () => {
    expect(await maybeProposeStageHandoff('p1')).toBe(true);
    const content = cardContent();
    expect(content).toContain('opt_stage_handoff_1');
    expect(content).toContain('stage_handoff_market');
    expect(content).toContain('stage_handoff_competitors');
  });

  it('offers PROMPTS, never a paid run', async () => {
    // The founder has just been told where they are. Spending their credits off
    // that same click would be a decision they have not made — and the market
    // option has a question of its own to answer first (item 7d).
    await maybeProposeStageHandoff('p1');
    expect(cardContent()).not.toContain('skill_id');
  });

  it('says nothing while the stage is still open', async () => {
    activeStageMock.mockReturnValue({ stage: { number: 1 } });
    expect(await maybeProposeStageHandoff('p1')).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('says it once — a stage finished last week is not news', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      sql.includes('chat_messages') ? [{ id: 'm1' }] : [{ owner_user_id: 'u1' }]);
    expect(await maybeProposeStageHandoff('p1')).toBe(false);
  });

  it('stays quiet for stages whose tasks do not exist yet', async () => {
    // Stages 3-7 have no task content (changelog item 1). Handing a founder
    // into a stage that cannot walk them through anything is worse than
    // silence: it promises a guide and delivers an empty room.
    for (const active of [3, 4, 5, 6, 7]) {
      activeStageMock.mockReturnValue({ stage: { number: active } });
      expect(await maybeProposeStageHandoff('p1'), `active ${active}`).toBe(false);
    }
    expect([...HANDOFF_FROM_STAGES]).toEqual([1]);
  });

  it('is non-fatal — a handoff problem cannot break the write that triggered it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runMock.mockRejectedValue(new Error('db down'));
    expect(await maybeProposeStageHandoff('p1')).toBe(false);
    warn.mockRestore();
  });
});

describe('the per-stage tag', () => {
  beforeEach(() => {
    for (const m of [queryMock, runMock, snapshotMock, activeStageMock]) m.mockReset();
    snapshotMock.mockResolvedValue({});
    runMock.mockResolvedValue(undefined);
  });

  it('probes for THIS stage, so a Stage-1 handoff cannot suppress a later one', async () => {
    const probes: string[] = [];
    queryMock.mockImplementation(async (sql: string, ...args: unknown[]) => {
      if (!sql.includes('chat_messages')) return [{ owner_user_id: 'u1' }];
      probes.push(String(args[1]));
      return [];
    });
    activeStageMock.mockReturnValue({ stage: { number: 2 } });
    await maybeProposeStageHandoff('p1');
    expect(probes[0]).toContain('opt_stage_handoff_1');
  });
});

describe('it runs where a stage actually closes', () => {
  it('after a canvas write — the commit that usually greens Stage 1', () => {
    const route = read('src/app/api/projects/[projectId]/idea-canvas/route.ts');
    expect(route).toMatch(/maybeProposeStageHandoff\(projectId\)/);
    // Non-fatal at the call site too: the canvas write already succeeded.
    expect(route).toMatch(/maybeProposeStageHandoff\(projectId\)\.catch/);
  });

  it('and after a chat turn, beside the proposers that already run there', () => {
    const route = read('src/app/api/chat/route.ts');
    expect(route).toMatch(/step_\('stage-handoff'/);
    expect(route).toMatch(/step_\('market-scope'/);
  });
});
