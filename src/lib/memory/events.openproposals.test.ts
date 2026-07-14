import { describe, it, expect, vi, beforeEach } from 'vitest';

// openProposals (PR-A) surfaces agent skill proposals that have no matching run
// yet — non-evicting, collapsed by skill_id, with a turns_since / lapsed flag.
// It fires two queries via @/lib/db in a Promise.all: (0) unfulfilled proposals
// DESC, (1) recent chat_turn timestamps DESC. Mock both — no live DB.
const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));

import { openProposals } from '@/lib/memory/events';

// Proposals come back ORDER BY created_at DESC (newest first); the fn collapses
// by skill_id keeping the newest and counting the rest.
const PROPOSALS = [
  { skill_id: 'financial-model', created_at: '2026-07-12T10:45:00Z' },
  { skill_id: 'startup-scoring', created_at: '2026-07-12T10:00:00Z' },
  { skill_id: 'startup-scoring', created_at: '2026-07-12T09:00:00Z' },
];
const TURNS = [
  { created_at: '2026-07-12T11:00:00Z' },
  { created_at: '2026-07-12T10:30:00Z' },
  { created_at: '2026-07-12T08:00:00Z' },
];

describe('openProposals — non-evicting agent proposal ledger', () => {
  beforeEach(() => queryMock.mockReset());

  it('collapses by skill_id, counts re-proposals, orders newest-first', async () => {
    queryMock.mockResolvedValueOnce(PROPOSALS).mockResolvedValueOnce(TURNS);
    const out = await openProposals('u1', 'p1');
    expect(out.map((p) => p.skill_id)).toEqual(['financial-model', 'startup-scoring']);
    const ss = out.find((p) => p.skill_id === 'startup-scoring')!;
    expect(ss.times_proposed).toBe(2); // two open proposals of the same skill
    expect(ss.proposed_at).toBe('2026-07-12T10:00:00Z'); // newest of the two
  });

  it('computes turns_since from chat_turns after the proposal and flags lapsed (>=2)', async () => {
    queryMock.mockResolvedValueOnce(PROPOSALS).mockResolvedValueOnce(TURNS);
    const out = await openProposals('u1', 'p1');
    const fm = out.find((p) => p.skill_id === 'financial-model')!;
    const ss = out.find((p) => p.skill_id === 'startup-scoring')!;
    // fm @10:45 → only the 11:00 turn is after it → 1 turn, not lapsed.
    expect(fm.turns_since).toBe(1);
    expect(fm.lapsed).toBe(false);
    // ss @10:00 → 11:00 and 10:30 are after it → 2 turns, lapsed.
    expect(ss.turns_since).toBe(2);
    expect(ss.lapsed).toBe(true);
  });

  it('the proposals query filters to agent invoker and excludes fulfilled skills', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await openProposals('u1', 'p1');
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toContain("event_type = 'skill_invoked'");
    expect(sql).toContain("payload->>'invoker' = 'agent'");
    expect(sql).toContain('NOT EXISTS'); // no later skill_completed for the skill
    expect(sql).toContain("event_type = 'skill_completed'");
  });

  it('respects the limit', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      skill_id: `skill-${i}`,
      created_at: `2026-07-12T${String(23 - i).padStart(2, '0')}:00:00Z`,
    }));
    queryMock.mockResolvedValueOnce(many).mockResolvedValueOnce([]);
    const out = await openProposals('u1', 'p1', { limit: 3 });
    expect(out).toHaveLength(3);
  });

  it('degrades to [] on a DB error (never throws — must not block context assembly)', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    await expect(openProposals('u1', 'p1')).resolves.toEqual([]);
  });
});
