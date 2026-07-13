import { describe, it, expect, vi, beforeEach } from 'vitest';

// document-digest: chunked LLM extraction → staged validation items + watcher
// proposals, all through founder-approval rails. Mock every collaborator.
const { runAgentMock, stageMock, createPaMock, queryMock, recordEventMock } = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  stageMock: vi.fn(),
  createPaMock: vi.fn(),
  queryMock: vi.fn(),
  recordEventMock: vi.fn(),
}));
vi.mock('@/lib/pi-agent', () => ({ runAgent: runAgentMock }));
vi.mock('@/lib/cost-meter', () => ({ recordAgentUsage: vi.fn() }));
vi.mock('@/lib/pending-actions', () => ({ createPendingAction: createPaMock }));
vi.mock('@/lib/db', () => ({ query: queryMock, run: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/memory/events', () => ({ recordEvent: recordEventMock }));
vi.mock('@/lib/auto-stage-validation', () => ({ stageValidationItemsFromRaw: stageMock }));

import { digestDocument, chunkText } from '@/lib/document-digest';

const FINDINGS = JSON.stringify({
  canvas: { problem: 'Home cooks lack a legal sales channel.', solution: null },
  competitors: [{ name: 'HelloFresh', note: 'meal kits' }],
  market_size: [{ claim: 'EU prepared-meal market €21B (2025)' }],
  tech_facts: [{ aspect: 'regulatory', finding: 'CAP/SCIA required for home food sales' }],
  watch_suggestions: [{ name: 'HelloFresh', topic: 'competitor', rationale: 'largest adjacent player' }],
});

describe('chunkText (fix F3)', () => {
  it('splits long text into 16k chunks, max 4', () => {
    expect(chunkText('x'.repeat(10_000))).toHaveLength(1);
    expect(chunkText('x'.repeat(33_000))).toHaveLength(3);
    expect(chunkText('x'.repeat(200_000))).toHaveLength(4); // capped
  });
});

describe('digestDocument', () => {
  beforeEach(() => {
    runAgentMock.mockReset(); stageMock.mockReset(); createPaMock.mockReset();
    queryMock.mockReset(); recordEventMock.mockReset();
    stageMock.mockResolvedValue({ staged: true, itemCount: 4 });
    createPaMock.mockResolvedValue({ id: 'pa_1' });
    // watcher-dedup lookup + owner lookup
    queryMock.mockImplementation(async (sql: string) => (String(sql).includes('owner_user_id') ? [{ owner_user_id: 'u1' }] : []));
  });

  it('stages canvas/competitor/market/tech items via the approval gate with the doc as source', async () => {
    runAgentMock.mockResolvedValue({ text: FINDINGS, usage: {} });
    const r = await digestDocument({ projectId: 'p1', factId: 'fact_1', filename: 'deck.pdf', text: 'short doc' });
    expect(r.staged_items).toBe(4);
    expect(stageMock).toHaveBeenCalledOnce();
    const [pid, raw, origin] = stageMock.mock.calls[0];
    expect(pid).toBe('p1');
    expect(origin).toContain('deck.pdf');
    const kinds = raw.map((x: { kind: string }) => x.kind).sort();
    expect(kinds).toEqual(['canvas_field', 'competitor', 'market_size_fact', 'tech_fact']);
    // every item carries the internal doc source
    expect(raw.every((x: { sources: Array<{ ref_id: string }> }) => x.sources?.[0]?.ref_id === 'fact_1')).toBe(true);
  });

  it('seeds a watcher proposal (fix F5) and dedups against existing monitors', async () => {
    runAgentMock.mockResolvedValue({ text: FINDINGS, usage: {} });
    const r1 = await digestDocument({ projectId: 'p1', factId: 'f1', filename: 'deck.pdf', text: 'doc' });
    expect(r1.watcher_proposals).toBe(1);
    expect(createPaMock.mock.calls[0][0].action_type).toBe('configure_monitor');
    // now an existing monitor with the same name → no new proposal
    queryMock.mockImplementation(async (sql: string) =>
      String(sql).includes('owner_user_id') ? [{ owner_user_id: 'u1' }] : [{ name: 'Configure monitor: HelloFresh' }]);
    createPaMock.mockClear();
    const r2 = await digestDocument({ projectId: 'p1', factId: 'f2', filename: 'deck2.pdf', text: 'doc' });
    expect(r2.watcher_proposals).toBe(0);
    expect(createPaMock).not.toHaveBeenCalled();
  });

  it('runs one extraction per chunk and merges (first canvas value wins)', async () => {
    runAgentMock
      .mockResolvedValueOnce({ text: FINDINGS, usage: {} })
      .mockResolvedValueOnce({ text: JSON.stringify({ canvas: { problem: 'LATER — must not win' }, competitors: [{ name: 'hellofresh' }], market_size: [], tech_facts: [], watch_suggestions: [] }), usage: {} });
    const r = await digestDocument({ projectId: 'p1', factId: 'f1', filename: 'long.pdf', text: 'x'.repeat(20_000) });
    expect(r.chunks).toBe(2);
    expect(runAgentMock).toHaveBeenCalledTimes(2);
    const raw = stageMock.mock.calls[0][1];
    const problem = raw.find((x: { kind: string; field?: string }) => x.field === 'problem');
    expect(problem.value).toContain('legal sales channel'); // chunk 1 wins
    // competitor deduped case-insensitively across chunks
    expect(raw.filter((x: { kind: string }) => x.kind === 'competitor')).toHaveLength(1);
  });

  it('stages interviews from notes with structured extra fields (1C prefill)', async () => {
    const withInterviews = JSON.stringify({
      canvas: {}, competitors: [], market_size: [], tech_facts: [], watch_suggestions: [],
      interviews: [
        { person: 'Giulia R.', role: 'pasta lab owner', segment: 'artisan', summary: 'Sells only at markets; wants online channel.', top_pain: 'no legal way to ship fresh', urgency: 'high', wtp_amount: 89, wtp_currency: 'EUR' },
        { person: 'Marco B.', role: null, segment: null, summary: 'Skeptical of D2C margins.', top_pain: null, urgency: 'low', wtp_amount: null, wtp_currency: null },
      ],
    });
    runAgentMock.mockResolvedValue({ text: withInterviews, usage: {} });
    await digestDocument({ projectId: 'p1', factId: 'f1', filename: 'interviews.md', text: 'notes' });
    const raw = stageMock.mock.calls[0][1];
    const ivs = raw.filter((x: { kind: string }) => x.kind === 'interview');
    expect(ivs).toHaveLength(2);
    expect(ivs[0].name).toBe('Giulia R.');
    expect(ivs[0].extra.wtp_amount).toBe(89);
    expect(ivs[0].extra.top_pain).toContain('no legal way');
    expect(ivs[1].extra.wtp_amount).toBeUndefined(); // null WTP stays absent
  });

  it('stages stage-3 persona/channel facts + stage-4 pricing (batch 1)', async () => {
    const withStage34 = JSON.stringify({
      canvas: { target_market: 'Artisan pasta labs in Lombardia', channels: 'Instagram creators + food fairs' },
      competitors: [], market_size: [], tech_facts: [], watch_suggestions: [], interviews: [],
      pricing: { model: 'subscription', anchor_price: 89, currency: 'EUR', tiers: ['Starter', 'Pro'], wtp_note: '5 labs quoted €80-90/mo' },
    });
    runAgentMock.mockResolvedValue({ text: withStage34, usage: {} });
    await digestDocument({ projectId: 'p1', factId: 'f1', filename: 'deck.pdf', text: 'doc' });
    const raw = stageMock.mock.calls[0][1];
    const kinds = raw.map((x: { kind: string }) => x.kind);
    expect(kinds).toContain('persona_fact');   // stage 3 icp_defined
    expect(kinds).toContain('channel_fact');   // stage 3 channels_identified
    // stage 4: one pricing item per stated field
    const pricing = raw.filter((x: { kind: string }) => x.kind === 'pricing');
    const fields = pricing.map((p: { field: string }) => p.field).sort();
    expect(fields).toEqual(['anchor_price', 'model', 'tiers', 'wtp']);
    const anchor = pricing.find((p: { field: string }) => p.field === 'anchor_price');
    expect(anchor.extra).toEqual({ anchor_price: 89, currency: 'EUR' });
  });

  it('records a document_digested timeline event', async () => {
    runAgentMock.mockResolvedValue({ text: FINDINGS, usage: {} });
    await digestDocument({ projectId: 'p1', factId: 'f1', filename: 'deck.pdf', text: 'doc' });
    expect(recordEventMock).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'document_digested' }));
  });

  it('never throws: LLM failure → empty result, upload unaffected', async () => {
    runAgentMock.mockRejectedValue(new Error('llm down'));
    const r = await digestDocument({ projectId: 'p1', factId: 'f1', filename: 'deck.pdf', text: 'doc' });
    expect(r.staged_items).toBe(0);
    expect(stageMock).not.toHaveBeenCalled();
  });
});
