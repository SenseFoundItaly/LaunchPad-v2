import { describe, it, expect, vi, beforeEach } from 'vitest';

// openKnowledgeProposals (gap 1) mirrors openProposals but for knowledge-
// suggestion facts, correlated by fact_hash. Mock @/lib/db's query (two calls:
// unfulfilled proposals, then chat_turn timestamps).
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));

import { openKnowledgeProposals, factHash } from '@/lib/memory/events';

describe('factHash — stable across propose/apply', () => {
  it('normalizes casing, whitespace, trailing punctuation', () => {
    expect(factHash('Marley Spoon charges €9.90 per meal.')).toBe(
      factHash('marley spoon   charges €9.90 per meal'),
    );
  });
  it('differs for genuinely different facts', () => {
    expect(factHash('Competitor A charges €9')).not.toBe(factHash('Competitor B charges €12'));
  });
});

describe('openKnowledgeProposals — proposed-but-not-applied facts', () => {
  beforeEach(() => queryMock.mockReset());

  it('dedupes by fact_hash (newest wins), computes turns_since + lapsed', async () => {
    queryMock
      .mockResolvedValueOnce([
        { fact_hash: 'aaa', fact_preview: 'Marley Spoon €9.90/meal', created_at: '2026-07-12T10:00:00Z' },
        { fact_hash: 'aaa', fact_preview: 'Marley Spoon €9.90/meal', created_at: '2026-07-12T08:00:00Z' },
        { fact_hash: 'bbb', fact_preview: 'TGTG launched Box Dispensa', created_at: '2026-07-12T10:45:00Z' },
      ])
      .mockResolvedValueOnce([
        { created_at: '2026-07-12T11:00:00Z' },
        { created_at: '2026-07-12T10:30:00Z' },
      ]);
    const out = await openKnowledgeProposals('u1', 'p1');
    expect(out).toHaveLength(2); // aaa deduped
    const aaa = out.find((k) => k.fact_hash === 'aaa')!;
    expect(aaa.proposed_at).toBe('2026-07-12T10:00:00Z'); // newest of the two
    expect(aaa.turns_since).toBe(2); // 11:00 and 10:30 are after 10:00
    expect(aaa.lapsed).toBe(true);
    const bbb = out.find((k) => k.fact_hash === 'bbb')!;
    expect(bbb.turns_since).toBe(1); // only 11:00 is after 10:45
    expect(bbb.lapsed).toBe(false);
  });

  it('query excludes facts already applied (NOT EXISTS on knowledge_applied by fact_hash)', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await openKnowledgeProposals('u1', 'p1');
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("event_type = 'knowledge_proposed'");
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("event_type = 'knowledge_applied'");
    expect(sql).toContain("c.payload->>'fact_hash' = pi.payload->>'fact_hash'");
  });

  it('degrades to [] on DB error', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    await expect(openKnowledgeProposals('u1', 'p1')).resolves.toEqual([]);
  });
});
