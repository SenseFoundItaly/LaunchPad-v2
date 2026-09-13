import { expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ query: vi.fn(), get: vi.fn(), run: vi.fn() }));
import { makeProjectTools } from '@/lib/project-tools';
import { query, get, run } from '@/lib/db';

it('blocks the actual pricing executor before any database write on a status question', async () => {
  const tools = makeProjectTools('p1', { userId: 'u1', founderMessage: 'What is our latest target segment and price hypothesis? What is saved?' });
  const pricing = tools.find(t => t.name === 'update_pricing')!;
  const result = await pricing.execute('call', { anchor_price: 29, currency: 'EUR' });
  expect(result.details).toEqual({ error: 'pricing_write_not_authorized' });
  expect(query).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it('keeps tool names, order and schemas identical when current write permission changes', () => {
  const signature = (message: string) => makeProjectTools('p1', { founderMessage: message }).map(t => [t.name, JSON.stringify(t.parameters)]);
  expect(signature('What is saved?')).toEqual(signature('Set the anchor price to 29 euros.'));
});

it('falls back from a topic description to scoped keyword search', async () => {
  vi.mocked(query).mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'original', role: 'user', content: 'Blue Fig 17; Tuesdays at 17:30; no POS for 60 days.' }]);
  const history = makeProjectTools('p1', { userId: 'u1', chatStep: 'chat' }).find(t => t.name === 'read_chat_history')!;
  const result = await history.execute('call', { query: 'pilot codename Blue Fig 17 meeting time', limit: 3 });
  expect(result.content).toEqual([expect.objectContaining({ text: expect.stringContaining('Tuesdays at 17:30') })]);
  const call = vi.mocked(query).mock.calls.at(-1)!;
  expect(call.slice(1, 3)).toEqual(['p1', 'chat']);
  expect(call[3]).toContain('Blue OR Fig OR 17');
});
