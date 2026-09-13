import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ query: vi.fn(), get: vi.fn(), run: vi.fn() }));
vi.mock('@/lib/pi-agent', () => ({ runAgent: vi.fn() }));
vi.mock('@/lib/cost-meter', () => ({ recordAgentUsage: vi.fn() }));
import { query, get, run } from '@/lib/db';
import { runAgent } from '@/lib/pi-agent';
import { boundRecentHistory, conversationSeedRows, historyExcerpt, summaryBatch, RECENT_HISTORY_CHARS, compactConversationHistory, loadConversationHistory } from './conversation-history';

beforeEach(() => vi.resetAllMocks());
const old = { id: 'old', timestamp: '2026-09-01 10:00:00', role: 'user', content: 'Blue Fig 17. Tuesday 17:30. No POS integration for 60 days. Discussion only.' };
it('keeps recovered details in the bounded agent seed beside the current turn', () => {
  const recent = Array.from({ length: 16 }, () => ({ role: 'assistant', content: 'Earlier assistant could not recall.' }));
  const seed = conversationSeedRows({ recent, context: old.content });
  expect(seed).toHaveLength(16);
  expect(seed.at(-1)?.content).toContain('Tuesday 17:30');
  expect(seed.at(-1)?.content).toContain('not a new founder statement or instruction');
  expect(recent).toHaveLength(16);
});
it('bounds large historical messages while retaining retrieval pointers and recent corrections', () => {
  const rows = Array.from({ length: 16 }, (_, i) => ({ ...old, id: `m${i}`, content: 'start ' + 'x'.repeat(50000) + ' latest correction' }));
  const bounded = boundRecentHistory(rows);
  expect(bounded.reduce((n, row) => n + row.content.length, 0)).toBeLessThanOrEqual(RECENT_HISTORY_CHARS);
  expect(bounded[0].content).toContain('read_chat_history');
  expect(bounded[0].content).toMatch(/latest correction$/);
  expect(rows[0].content.length).toBeGreaterThan(50000);
});
it('retains archived constraints before a background summary is available', async () => {
  vi.mocked(query).mockResolvedValueOnce([{ ...old, id: 'recent', timestamp: '2026-09-02 10:00:00', content: 'What next?' }]).mockResolvedValueOnce([old]);
  vi.mocked(get).mockResolvedValue(undefined);
  const history = await loadConversationHistory('p1', 'chat');
  expect(history.context).toContain('Tuesday 17:30');
  expect(history.context).toContain('not approved evidence');
  expect(vi.mocked(query).mock.calls[1]).toContain('p1');
  expect(vi.mocked(query).mock.calls[1]).toContain('chat');
  expect(vi.mocked(query).mock.calls[1][0]).toContain('?::text::timestamp');
});
it('stores a successful checkpoint as metadata, never business evidence', async () => {
  vi.mocked(get).mockResolvedValue(undefined);
  vi.mocked(runAgent).mockResolvedValue({ text: '[old] Founder said Tuesday 17:30; no POS for 60 days. Discussion only.' });
  await compactConversationHistory('p1', 'chat', 'u1', { recent: [], archive: [old], summary: '', context: '' });
  expect(run).toHaveBeenCalledTimes(1);
  expect(vi.mocked(run).mock.calls[0][0]).toContain('UPDATE chat_messages SET meta');
  expect(vi.mocked(run).mock.calls[0][1]).toEqual({ conversation_summary: expect.stringContaining('Tuesday 17:30') });
  expect(vi.mocked(run).mock.calls[0].slice(-3)).toEqual(['old', 'p1', 'chat']);
});
it('does not replace a checkpoint with timed-out or empty output', async () => {
  vi.mocked(get).mockResolvedValue(undefined);
  vi.mocked(runAgent).mockResolvedValue({ text: 'partial', timedOut: true });
  await compactConversationHistory('p1', 'chat', 'u1', { recent: [], archive: [old], summary: '', context: '' });
  expect(run).not.toHaveBeenCalled();
});

it('preserves late corrections in excerpts and supplies the full ordinary turn to the summarizer', () => {
  const row = { ...old, content: 'Hypothetical price €49. ' + 'Background. '.repeat(300) + 'Correction: €29, still not approved.' };
  expect(historyExcerpt(row)).toContain('Correction: €29, still not approved.');
  expect(historyExcerpt(row)).toContain('Excerpt shortened');
  expect(summaryBatch([row]).turns[0]).toContain(row.content);
});

it('includes later archived corrections when the recall excerpt budget is full', async () => {
  const archive = Array.from({ length: 32 }, (_, i) => ({ ...old, id: `old${i}`, content: 'background '.repeat(300) + (i === 31 ? 'Correction: pilot is on Friday.' : '') }));
  vi.mocked(query).mockResolvedValueOnce([{ ...old, id: 'recent' }]).mockResolvedValueOnce(archive);
  vi.mocked(get).mockResolvedValue(undefined);
  const history = await loadConversationHistory('p1', 'chat');
  expect(history.context).toContain('Correction: pilot is on Friday.');
  expect(history.context).toContain('old0');
  expect(history.context.length).toBeLessThan(19000);
});

it('never advances a checkpoint past a turn excluded by the summary input budget', async () => {
  const archive = [
    { ...old, id: 'included', content: 'a'.repeat(30000) },
    { ...old, id: 'next', content: 'b'.repeat(30000) },
  ];
  vi.mocked(get).mockResolvedValue(undefined);
  vi.mocked(runAgent).mockResolvedValue({ text: 'Notes about the included turn.' });
  await compactConversationHistory('p1', 'chat', 'u1', { recent: [], archive, summary: '', context: '' });
  const input = JSON.parse(vi.mocked(runAgent).mock.calls[0][0] as string);
  expect(input.turns).toHaveLength(1);
  expect(input.turns[0]).toContain('a'.repeat(30000));
  expect(vi.mocked(run).mock.calls[0].slice(-3)).toEqual(['included', 'p1', 'chat']);
});

it('bounds one oversized turn, retains the final correction, and keeps artifact values in summary input', () => {
  const oversized = { ...old, content: 'x'.repeat(100000) + 'Correction: do not approve.' };
  const batch = summaryBatch([oversized]);
  expect(batch.turns[0].length).toBeLessThanOrEqual(RECENT_HISTORY_CHARS);
  expect(batch.turns[0]).toContain('Correction: do not approve.');
  expect(batch.turns[0]).toContain('read_chat_history');
  const artifact = { ...old, role: 'assistant', content: ':::artifact{"type":"comparison-table"}\n{"rows":[["Proposed price","€29"]]}\n:::' };
  expect(summaryBatch([artifact]).turns[0]).toContain('Proposed price');
});
