import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Changelog 05/09 item 7f — "Quando runna analisi competitor farei generare un
 * report dettagliato nel canvas a dx + una chiara call to action in chat con
 * due possibilità → 1) Cercare ulteriori competitors; 2) andare nella sezione
 * knowledge per approvare i competitors trovati."
 *
 * The CTA matters more than it reads. Competitors extracted from a chat table
 * are staged `reviewed_state='pending'` on purpose (2026-06-12: an
 * agent-emitted table must not silently green the spine). So the founder
 * watches an analysis run, sees a table of competitors, and
 * `competitors_mapped` stays red — because the step that closes it happens on a
 * page nothing ever pointed them to.
 */

const { queryMock, runMock } = vi.hoisted(() => ({ queryMock: vi.fn(), runMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ query: queryMock, run: runMock, get: vi.fn() }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/i18n/resolve-locale', () => ({ resolveLocale: vi.fn(async () => 'it') }));

import { maybeProposeCompetitorReview, pendingCompetitorCount } from './competitor-review-cta';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const card = () => String(runMock.mock.calls[0][3]);

/** Route the two reads the module makes: the pending count and the open-card probe. */
function mockDb({ pending = 3, cardOpen = false } = {}) {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('graph_nodes')) return [{ n: pending }];
    if (sql.includes('chat_messages')) return cardOpen ? [{ id: 'm1' }] : [];
    return [{ owner_user_id: 'u1' }];
  });
}

describe('the CTA appears exactly when competitors are waiting', () => {
  beforeEach(() => {
    queryMock.mockReset(); runMock.mockReset();
    runMock.mockResolvedValue(undefined);
  });

  it('counts only PENDING competitors — approved ones need no call to action', async () => {
    mockDb();
    await pendingCompetitorCount('p1');
    const sql = String(queryMock.mock.calls[0][0]);
    expect(sql).toMatch(/node_type = 'competitor'/);
    expect(sql).toMatch(/reviewed_state = 'pending'/);
  });

  it('offers exactly the two options Luca asked for, and no third', async () => {
    mockDb({ pending: 4 });
    expect(await maybeProposeCompetitorReview('p1')).toBe(true);
    const body = JSON.parse(card().split('\n')[1]);
    expect(body.options).toHaveLength(2);
    expect(body.options.map((o: { id: string }) => o.id))
      .toEqual(['competitor_review_more', 'competitor_review_approve']);
  });

  it('names the count, so the founder knows what is waiting', async () => {
    mockDb({ pending: 4 });
    await maybeProposeCompetitorReview('p1');
    expect(card()).toContain('4');
  });

  it('the approve option NAVIGATES — it does not ask the agent to go for them', async () => {
    mockDb();
    await maybeProposeCompetitorReview('p1');
    const body = JSON.parse(card().split('\n')[1]);
    expect(body.options[1].navigate_to).toBe('knowledge');
    // The other option is a prompt: widening the search IS a conversation.
    expect(body.options[0].navigate_to).toBeUndefined();
  });

  it('stays silent when nothing is pending', async () => {
    mockDb({ pending: 0 });
    expect(await maybeProposeCompetitorReview('p1')).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('never stacks a second card', async () => {
    mockDb({ cardOpen: true });
    expect(await maybeProposeCompetitorReview('p1')).toBe(false);
  });

  it('is non-fatal — a CTA problem cannot break the turn that found them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockDb();
    runMock.mockRejectedValue(new Error('db down'));
    expect(await maybeProposeCompetitorReview('p1')).toBe(false);
    warn.mockRestore();
  });
});

describe('navigation is wired, and cannot go anywhere', () => {
  it('both renderers handle navigate_to', () => {
    for (const f of [
      'src/components/chat/artifacts/OptionSetCard.tsx',
      'src/app/project/[projectId]/chat/page.tsx',
    ]) {
      expect(read(f), f).toMatch(/if \(option\.navigate_to\)/);
    }
  });

  it('destinations are a fixed map — artifact text is model output', () => {
    // An option that can navigate anywhere is an open redirect wearing a
    // button. `to` arrives inside an artifact block the model wrote.
    const page = read('src/app/project/[projectId]/chat/page.tsx');
    expect(page).toMatch(/const DESTINATIONS: Record<string, string>/);
    expect(page).toMatch(/if \(!href\) throw new Error/);
    expect(page).not.toMatch(/nav\.push\(String\(payload/);
  });

  it('and it is a client-side push, so the transcript survives', () => {
    expect(read('src/app/project/[projectId]/chat/page.tsx')).toMatch(/nav\.push\(href\)/);
  });
});

describe('it runs where competitors get staged', () => {
  it('in the chat post-turn hook, beside the other proposers', () => {
    expect(read('src/app/api/chat/route.ts')).toMatch(/step_\('competitor-cta'/);
  });
});
