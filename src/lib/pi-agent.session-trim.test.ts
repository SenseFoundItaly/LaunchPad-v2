import { describe, it, expect } from 'vitest';
import { trimSessionMessages } from '@/lib/pi-agent';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

// trimSessionMessages is the shape-guard between the persisted session file and
// what the provider will accept. These tests pin the two poisoning classes the
// 2026-09-01 audit measured live (11% of sessions one warm turn from a 400)
// plus the long-dead unpaired-call guard.

const user = (text: string) => ({ role: 'user', content: text }) as unknown as AgentMessage;
const assistant = (content: unknown) => ({ role: 'assistant', content, stopReason: 'stop' }) as unknown as AgentMessage;
const toolCallMsg = (id: string) =>
  ({ role: 'assistant', content: [{ type: 'toolCall', id, name: 'web_search', arguments: {} }], stopReason: 'toolUse' }) as unknown as AgentMessage;
const toolResult = (id: string) =>
  ({ role: 'toolResult', toolCallId: id, content: [{ type: 'text', text: 'result' }] }) as unknown as AgentMessage;

describe('trimSessionMessages — trailing incomplete turns', () => {
  it('drops a trailing assistant turn with an unpaired toolCall (pi-ai persisted shape)', () => {
    // The old guard grepped for 'tool_use' (Anthropic wire name) — pi-ai
    // persists 'toolCall', so every timeout-aborted agentic turn slipped
    // through and poisoned the next warm turn. This is the regression pin.
    const out = trimSessionMessages([user('q1'), assistant('a1'), user('q2'), toolCallMsg('t1')]);
    expect(out).toEqual([user('q1'), assistant('a1')]);
  });

  it('keeps a complete toolCall→toolResult exchange', () => {
    const msgs = [user('q'), toolCallMsg('t1'), toolResult('t1'), assistant('final answer')];
    expect(trimSessionMessages([...msgs])).toEqual(msgs);
  });

  it('drops a trailing empty assistant turn and its user message', () => {
    const out = trimSessionMessages([user('q1'), assistant('a1'), user('q2'), assistant([])]);
    expect(out).toEqual([user('q1'), assistant('a1')]);
  });

  it('strips trailing orphaned user messages', () => {
    const out = trimSessionMessages([user('q1'), assistant('a1'), user('dangling')]);
    expect(out).toEqual([user('q1'), assistant('a1')]);
  });
});

describe('trimSessionMessages — sliding window', () => {
  it('caps to the most recent N messages', () => {
    const msgs = [user('q1'), assistant('a1'), user('q2'), assistant('a2'), user('q3'), assistant('a3')];
    expect(trimSessionMessages([...msgs], 4)).toEqual(msgs.slice(2));
  });

  it('drops orphaned leading toolResults when the window opens mid tool-exchange', () => {
    // The measured 11% poisoned-window state: the position-based slice cut off
    // the toolCall assistant turn but kept its toolResults at the head — a
    // shape the provider rejects outright.
    const msgs = [
      user('q1'), toolCallMsg('t1'), toolResult('t1'), toolResult('t2'),
      assistant('a1'), user('q2'), assistant('a2'),
    ];
    // Window of 5 opens on toolResult('t1').
    const out = trimSessionMessages([...msgs], 5);
    expect((out[0] as { role?: string }).role).not.toBe('toolResult');
    expect(out).toEqual([assistant('a1'), user('q2'), assistant('a2')]);
  });

  it('returns [] rather than a window that is nothing but orphaned plumbing', () => {
    const out = trimSessionMessages([toolResult('t1'), toolResult('t2')], 4);
    expect(out).toEqual([]);
  });
});
