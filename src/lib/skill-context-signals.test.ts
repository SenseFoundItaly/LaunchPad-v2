import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * #129 — watcher signals (L1) must reach the skill prompt (L2).
 *
 * Guards the inbound half of the L1↔L2 flywheel. Before this, watchers collected
 * market intelligence the paid product never consumed: buildSkillProjectContext
 * injected canvas/research/competitors/facts and had zero signal references.
 *
 * DB is mocked — this pins the CONTRACT (are signals fetched, rendered, and
 * honestly attributed), not the data.
 */

const alertRows = [
  { headline: 'Competitor X raised a $12M Series A', entity: 'Competitor X', source: 'techcrunch', reviewed_state: 'pending' },
  { headline: 'Incumbent ships the same feature natively', entity: 'Incumbent', source: null, reviewed_state: 'accepted' },
];

const queryMock = vi.fn();

vi.mock('@/lib/db', () => ({
  get: vi.fn(async () => ({ name: 'StandSync', description: 'async standups' })),
  query: (...args: unknown[]) => queryMock(...args),
}));

vi.mock('@/lib/journey/snapshot', () => ({
  buildProjectSnapshot: vi.fn(async () => ({
    idea_canvas: { problem: 'standups waste time', solution: 'async digest' },
    research: null,
    competitors: [],
    memory_facts: [],
    interviews: [],
  })),
}));

vi.mock('@/lib/research-context', () => ({ marketSizingProse: () => '' }));

const load = async () => (await import('./skill-context')).buildSkillProjectContext;

beforeEach(() => {
  vi.resetModules();
  queryMock.mockReset();
});

describe('#129 — watcher signals reach the skill prompt', () => {
  it('renders signals, most-relevant first, with the entity and source', async () => {
    queryMock.mockResolvedValue(alertRows);
    const ctx = await (await load())('proj_1', 'market-research');

    expect(ctx).toContain('Market signals from your watchers');
    expect(ctx).toContain('Competitor X raised a $12M Series A');
    expect(ctx).toContain('re: Competitor X');
    expect(ctx).toContain('via techcrunch');
  });

  it('labels review state so an unreviewed signal is never laundered as a founder fact', async () => {
    queryMock.mockResolvedValue(alertRows);
    const ctx = await (await load())('proj_1');

    // The provenance rule the chat prompt enforces applies here too.
    expect(ctx).toContain('unreviewed');
    expect(ctx).toContain('accepted');
    expect(ctx).toContain('not founder-confirmed facts');
    // Signals must NOT be filed under the founder-asserted heading.
    const factsIdx = ctx.indexOf('Founder-asserted facts');
    const sigIdx = ctx.indexOf('Market signals');
    if (factsIdx >= 0) expect(sigIdx).toBeGreaterThan(factsIdx);
  });

  it('orders by relevance, not recency alone', async () => {
    queryMock.mockResolvedValue(alertRows);
    await (await load())('proj_1');
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/ORDER BY\s+relevance_score DESC/);
    expect(sql).toContain('ecosystem_alerts');
  });

  it('degrades to no signals when ecosystem_alerts is missing (stale DB)', async () => {
    // Mirrors freshSignals in direction/index.ts: a missing table must not fail
    // the whole skill run, it must just contribute nothing.
    queryMock.mockRejectedValue(new Error('relation "ecosystem_alerts" does not exist'));
    const ctx = await (await load())('proj_1');

    expect(ctx).not.toContain('Market signals');
    expect(ctx).toContain('PROJECT CONTEXT'); // the rest of the context still built
  });

  it('omits the block entirely when there are no signals', async () => {
    queryMock.mockResolvedValue([]);
    const ctx = await (await load())('proj_1');
    expect(ctx).not.toContain('Market signals');
  });
});
