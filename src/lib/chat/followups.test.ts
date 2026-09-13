import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/types';
import { mergeChatFollowups } from './followups';

const message = (id: string, content: string, second: number): ChatMessage => ({
  id, role: 'assistant', content, timestamp: new Date(1_000 * second).toISOString(),
});

describe('server follow-up reconciliation', () => {
  it('adds a deferred handoff without replacing an unfinished reply', () => {
    const live = message('local', 'Working…', 1);
    const followup = message('server', 'Stage completed', 2);
    const merged = mergeChatFollowups([live], [followup]);
    expect(merged).toEqual([live, followup]);
    expect(merged[0]).toBe(live);
  });
  it('does not duplicate on polling, mutation response, or tab return', () => {
    const scope = message('scope-id', 'Run market sizing', 2);
    const current = mergeChatFollowups([], [scope]);
    expect(mergeChatFollowups(current, [scope, scope])).toBe(current);
  });
  it('keeps distinct decisions with the same text and orders delayed arrivals', () => {
    const later = message('later', 'Continue', 3);
    const earlier = message('earlier', 'Continue', 2);
    expect(mergeChatFollowups([later], [earlier])).toEqual([earlier, later]);
  });
});
