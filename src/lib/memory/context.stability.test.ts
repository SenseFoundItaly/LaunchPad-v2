import { describe, it, expect } from 'vitest';

// The memory block is concatenated into the chat system prompt, which pi-ai
// marks with `cache_control`. Anthropic prompt caching is a PREFIX match, so a
// single byte of per-turn drift in here invalidates the whole ~20k-token cached
// prefix and turns a 0.30 $/M read into a 3.75 $/M write.
//
// Measured on prod 2026-08-10 (30d, llm_usage_logs): chat cache writes were
// 14.73M tokens ≈ $55 ≈ 74% of chat spend, and 84% of those writes landed on
// turns that arrived within 5 minutes of the previous one — i.e. while the
// cache was still LIVE. Those writes are prefix mutation, not expiry.
//
// These tests guard the invariant, not the prose. Reword any label you like;
// just keep the output a pure function of the context.
import { formatMemoryContextMarkdown } from '@/lib/memory/context';
import type { ProjectContext } from '@/lib/memory/gather-context';

function ctx(over: Partial<ProjectContext> = {}): ProjectContext {
  return {
    context_built_at: '2026-08-10T14:23:51.402Z',
    project: { id: 'proj_1', name: 'LocalPulse', description: 'd', status: 'active', locale: 'en' },
    score: null,
    facts: [{ kind: 'insight', fact: 'Founders churn at onboarding' }],
    events: [
      { id: 'e1', user_id: 'u1', project_id: 'proj_1', event_type: 'chat_turn',
        payload: { preview: 'asked about pricing' }, created_at: '2026-08-10T14:20:11.883Z' },
    ],
    openProposals: [
      { skill_id: 'startup-scoring', proposed_at: '2026-08-10T13:00:00Z',
        turns_since: 3, times_proposed: 1, lapsed: false },
    ],
    openKnowledgeProposals: [
      { fact_preview: 'ARPU is 24 EUR', fact_hash: 'h1',
        proposed_at: '2026-08-10T13:10:00Z', turns_since: 3, lapsed: false },
    ],
    inbox: null, tasks: null, briefs: null, risks: null,
    graph: null, graphNodes: null, skills: null, alerts: null, messages: null,
    failedSections: [],
    ...over,
  } as ProjectContext;
}

describe('formatMemoryContextMarkdown — cached-prefix stability', () => {
  it('is a pure function: same context renders byte-identically', () => {
    expect(formatMemoryContextMarkdown(ctx())).toBe(formatMemoryContextMarkdown(ctx()));
  });

  it('ignores context_built_at — rebuilding the context must not move the prefix', () => {
    // Same project state, gathered a minute later. This is the exact shape of
    // the old `Context as of: ...` line, which re-wrote the cache every turn.
    const a = formatMemoryContextMarkdown(ctx({ context_built_at: '2026-08-10T14:23:51.402Z' }));
    const b = formatMemoryContextMarkdown(ctx({ context_built_at: '2026-08-10T14:24:57.119Z' }));
    expect(b).toBe(a);
  });

  it('renders event timestamps at day granularity, not the instant', () => {
    const out = formatMemoryContextMarkdown(ctx());
    expect(out).toContain('- 2026-08-10 [chat_turn]');
    expect(out).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('does not leak wall-clock time from anywhere else', () => {
    const out = formatMemoryContextMarkdown(ctx({ events: null, openProposals: null }));
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('collapses proposal age into few buckets, so most turns do not move the prefix', () => {
    // Deliberately does NOT pin the bucket labels — pick whatever bucketing you
    // want in proposalAge(). What must hold is that age is COARSE: a counter
    // that ticks every turn (the old "N turns ago") yields 21 distinct strings
    // here and guarantees a cache write on every single turn.
    const renders = new Set(
      Array.from({ length: 21 }, (_, turnsSince) =>
        formatMemoryContextMarkdown(
          ctx({
            openProposals: [{
              skill_id: 'startup-scoring', proposed_at: '2026-08-10T13:00:00Z',
              turns_since: turnsSince, times_proposed: 1, lapsed: false,
            }],
            openKnowledgeProposals: null,
          }),
        ),
      ),
    );
    expect(renders.size).toBeLessThanOrEqual(6);
  });

  it('keeps LAPSED and times_proposed — they carry signal and change rarely', () => {
    const lapsed = formatMemoryContextMarkdown(ctx({
      openProposals: [{
        skill_id: 'startup-scoring', proposed_at: '2026-08-10T13:00:00Z',
        turns_since: 9, times_proposed: 2, lapsed: true,
      }],
    }));
    expect(lapsed).toContain('LAPSED');
    expect(lapsed).toContain('proposed 2×');
  });
});
