import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Changelog 05/09 item 7d — "Prima della ricerca TAM SAM SOM, chatbot dovrebbe
 * chiedermi se vogliamo considerare un mercato 'addressable' italiano, europeo
 * o internazionale, in base alle prospettive strategiche del founder."
 *
 * The failure this prevents is quiet: nothing errors, a number simply comes
 * back for the wrong geography. A global TAM handed to a founder who will only
 * ever sell to Italian dental practices reads as ambition and plans as fiction,
 * and every artifact under it — SAM, SOM, revenue model, the gate's market_size
 * evidence — inherits the mistake.
 */

const { getMock, runMock, queryMock, snapshotMock, activeStageMock } = vi.hoisted(() => ({
  getMock: vi.fn(), runMock: vi.fn(), queryMock: vi.fn(),
  snapshotMock: vi.fn(), activeStageMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ get: getMock, run: runMock, query: queryMock }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveLocale: vi.fn(async () => 'it') }));
vi.mock('@/lib/journey', () => ({
  buildProjectSnapshot: snapshotMock,
  activeStageFor: activeStageMock,
}));

import {
  readMarketScope, marketScopeRunBlocked, marketScopeContextLine,
  maybeProposeMarketScope, MARKET_SIZING_SKILLS, MARKET_SCOPES,
} from './market-scope';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('what counts as a recorded scope', () => {
  it('accepts the shape the route writes', () => {
    expect(readMarketScope({ scope: 'IT', decided_at: '2026-09-09T00:00:00.000Z' }))
      .toEqual({ scope: 'IT', decided_at: '2026-09-09T00:00:00.000Z' });
  });

  it('accepts jsonb that arrives as a string', () => {
    // Drivers differ on whether jsonb comes back parsed; both must work or the
    // gate re-asks a founder who already answered.
    expect(readMarketScope('{"scope":"EU","decided_at":"x"}')?.scope).toBe('EU');
  });

  it('rejects anything that is not one of the three scopes', () => {
    for (const bad of [null, undefined, {}, { scope: 'ITALY' }, { scope: 'it' }, 'nope', 42, '{bad json']) {
      expect(readMarketScope(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('survives the column not existing at all', () => {
    // 047 may not have run: every reader must treat that as "not asked yet"
    // rather than throwing on a project that predates the migration.
    expect(readMarketScope(undefined)).toBeNull();
  });
});

describe('which runs wait for the answer', () => {
  beforeEach(() => { getMock.mockReset(); });

  it('blocks the sizing run while the scope is unanswered', async () => {
    getMock.mockResolvedValue({ market_scope: null });
    expect(await marketScopeRunBlocked('p1', 'market-research')).toBe(true);
  });

  it('lets it through once answered', async () => {
    getMock.mockResolvedValue({ market_scope: { scope: 'IT', decided_at: 'x' } });
    expect(await marketScopeRunBlocked('p1', 'market-research')).toBe(false);
  });

  it('never blocks a skill whose job is not sizing the market', async () => {
    getMock.mockResolvedValue({ market_scope: null });
    for (const id of ['startup-scoring', 'business-model', 'customer-interviews', 'gtm-strategy']) {
      expect(await marketScopeRunBlocked('p1', id), id).toBe(false);
    }
    expect(MARKET_SIZING_SKILLS.has('market-research')).toBe(true);
  });

  it('fails OPEN on a database problem', async () => {
    // A missed question costs a re-run; a false block costs the founder a
    // feature they paid for. The asymmetry decides which way this fails.
    getMock.mockRejectedValue(new Error('column research.market_scope does not exist'));
    expect(await marketScopeRunBlocked('p1', 'market-research')).toBe(false);
  });
});

describe('the answer reaches the run', () => {
  it('every scope produces a context line that names the geography', () => {
    for (const scope of MARKET_SCOPES) {
      const line = marketScopeContextLine({ market_scope: { scope, decided_at: 'x' } });
      expect(line, scope).toBeTruthy();
      expect(line, scope).toMatch(/ADDRESSABLE MARKET/);
    }
  });

  it('says nothing at all when unanswered — the prompt is unchanged for old projects', () => {
    expect(marketScopeContextLine({})).toBeNull();
    expect(marketScopeContextLine(null)).toBeNull();
  });

  it('is injected beside the established sizing, not somewhere a run could miss it', () => {
    const ctx = read('src/lib/skill-context.ts');
    const sizing = ctx.indexOf('Established market sizing');
    const scope = ctx.indexOf('marketScopeContextLine(research)');
    expect(sizing).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(sizing);
  });
});

describe('when the question gets asked', () => {
  beforeEach(() => {
    for (const m of [getMock, runMock, queryMock, snapshotMock, activeStageMock]) m.mockReset();
    // Two different queries go through `query` here — the project's owner and
    // the "is a card already open" probe. A single mockResolvedValue answers
    // both with a row, which reads as a card already waiting.
    queryMock.mockImplementation(async (sql: string) =>
      sql.includes('chat_messages') ? [] : [{ owner_user_id: 'u1' }]);
    getMock.mockResolvedValue({ market_scope: null });
    snapshotMock.mockResolvedValue({});
    activeStageMock.mockReturnValue({ stage: { number: 2 } });
    runMock.mockResolvedValue(undefined);
  });

  it('asks on entering Stage 2, before the founder reaches for the sizing', async () => {
    expect(await maybeProposeMarketScope('p1')).toBe(true);
    const content = String(runMock.mock.calls[0][3]);
    expect(content).toContain('opt_market_scope');
    for (const scope of MARKET_SCOPES) expect(content).toContain(`"market_scope":"${scope}"`);
  });

  it('does not interrupt Stage 1 — that founder is still deciding what to build', async () => {
    activeStageMock.mockReturnValue({ stage: { number: 1 } });
    expect(await maybeProposeMarketScope('p1')).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('never re-asks a founder who already answered', async () => {
    getMock.mockResolvedValue({ market_scope: { scope: 'EU', decided_at: 'x' } });
    expect(await maybeProposeMarketScope('p1')).toBe(false);
  });

  it('never stacks a second card on an unanswered one', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      sql.includes('chat_messages') ? [{ id: 'm1' }] : [{ owner_user_id: 'u1' }]);
    expect(await maybeProposeMarketScope('p1')).toBe(false);
  });

  it('is non-fatal — a staging failure cannot break its caller', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    runMock.mockRejectedValue(new Error('db down'));
    expect(await maybeProposeMarketScope('p1')).toBe(false);
    warn.mockRestore();
  });
});

describe('the choice is wired end to end', () => {
  it('BOTH option renderers record the scope — neither may narrate it instead', () => {
    // The file header warns about this exact trap: an option field one renderer
    // does not know degrades to a narrated-but-never-performed choice.
    for (const f of [
      'src/components/chat/artifacts/OptionSetCard.tsx',
      'src/app/project/[projectId]/chat/page.tsx',
    ]) {
      expect(read(f), f).toMatch(/if \(option\.market_scope\)/);
      expect(read(f), f).toMatch(/market-scope:record/);
    }
  });

  it('the client handler posts to the route, and the route is the only writer', () => {
    const page = read('src/app/project/[projectId]/chat/page.tsx');
    expect(page).toMatch(/action === 'market-scope:record'/);
    expect(page).toMatch(/\/api\/projects\/\$\{projectId\}\/market-scope/);
    // Rejects anything but the three scopes before it ever reaches the network.
    expect(page).toMatch(/scope !== 'IT' && scope !== 'EU' && scope !== 'INTL'/);
  });

  it('the run gate spends nothing: it sits after the credit check, before runSkill', () => {
    const route = read('src/app/api/projects/[projectId]/skills/route.ts');
    const credits = route.indexOf('assertCreditsAvailable');
    const gate = route.indexOf('marketScopeRunBlocked');
    const runSkill = route.indexOf('await runSkill(');
    expect(gate).toBeGreaterThan(credits);
    expect(gate).toBeLessThan(runSkill);
    // And it hands back the question, not just a refusal.
    expect(route).toMatch(/maybeProposeMarketScope\(projectId\)/);
    expect(route).toMatch(/market_scope_required/);
  });

  it('the founder sees the reason — the 422 surfaces as an assistant bubble', () => {
    // The handled codes live in one Set now (dead-end audit 2026-09-10), so a
    // new server code is one line here rather than another || in a chain.
    const page = read('src/app/project/[projectId]/chat/page.tsx');
    const block = page.slice(page.indexOf('const BLOCKED_BEFORE_SPEND'), page.indexOf('const BLOCKED_BEFORE_SPEND') + 400);
    expect(block).toContain("'market_scope_required'");
  });

  it('the migration is additive and safe to skip', () => {
    const mig = read('db/migrations/047_market_scope.sql');
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS market_scope/);
    // The snapshot reads SELECT *, so a database without 047 must still work.
    expect(read('src/lib/journey/snapshot.ts')).toMatch(/SELECT \* FROM research/);
  });
});
