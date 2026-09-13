import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/db', () => ({ query: vi.fn(), get: vi.fn(), run: vi.fn() }));
import { isDiscussionOnly, blockDiscussionWrite } from './discussion-policy';
import { makeProjectTools } from '../project-tools';
import { query, get, run } from '@/lib/db';

beforeEach(() => vi.clearAllMocks());

it.each(['Discussion only; do not save anything.', 'Compare without saving.', 'Confronta senza salvare.', 'Non salvare questa ipotesi.'])(
  'respects the current founder scope: %s', text => expect(isDiscussionOnly(text)).toBe(true),
);

it('inherits no-save scope through affirmations, never from an assistant granting itself permission', () => {
  const history = [
    { role: 'user', content: 'Compare the options. Discussion only.' },
    { role: 'assistant', content: 'Shall I save them?' },
    { role: 'user', content: 'yes' },
  ];
  expect(isDiscussionOnly('go ahead', history)).toBe(true);
  expect(isDiscussionOnly('Now save the chosen option.', history)).toBe(false);
  expect(isDiscussionOnly('yes', [{ role: 'assistant', content: 'Discussion only.' }])).toBe(false);
});

it('preserves the exact tool schemas while preventing every registered project write executor', async () => {
  const regular = makeProjectTools('p1', { userId: 'u1' });
  const discussion = makeProjectTools('p1', { userId: 'u1', discussionOnly: true });
  const signature = (tools: typeof regular) => tools.map(({ execute: _execute, ...schema }) => schema);
  expect(signature(discussion)).toEqual(signature(regular));
  const reads = new Set(makeProjectTools('p1', { includeWriteTools: false }).map(t => t.name));
  for (const tool of discussion.filter(t => !reads.has(t.name))) {
    expect((await tool.execute('probe', {})).details).toEqual({ error: 'discussion_only' });
  }
  expect(query).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it('blocks a skill executor without invoking its side effects', async () => {
  const tool = makeProjectTools('p1')[0];
  const execute = vi.fn();
  const guarded = blockDiscussionWrite({ ...tool, execute });
  await guarded.execute('probe', {});
  expect(execute).not.toHaveBeenCalled();
});
