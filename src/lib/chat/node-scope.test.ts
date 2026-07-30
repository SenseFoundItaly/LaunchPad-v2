import { describe, it, expect } from 'vitest';
import { nodeChatStep, parseNodeStep, sessionSuffixForStep } from './node-scope';

describe('nodeChatStep / parseNodeStep', () => {
  it('round-trips a node id through the step', () => {
    expect(parseNodeStep(nodeChatStep('node_abc'))).toBe('node_abc');
  });

  it('returns null for the ordinary project-wide steps', () => {
    for (const step of ['chat', 'research', 'simulation', '']) {
      expect(parseNodeStep(step)).toBeNull();
    }
    expect(parseNodeStep(undefined)).toBeNull();
    expect(parseNodeStep(null)).toBeNull();
  });

  it('returns null for a bare/blank node step — a malformed step must never widen into an unscoped lookup', () => {
    expect(parseNodeStep('node:')).toBeNull();
    expect(parseNodeStep('node:   ')).toBeNull();
  });

  it('does not match a step that merely CONTAINS the prefix', () => {
    expect(parseNodeStep('chat-node:x')).toBeNull();
  });
});

describe('sessionSuffixForStep', () => {
  it('is empty for project-wide steps — existing agent sessions keep their shared memory', () => {
    expect(sessionSuffixForStep('chat')).toBe('');
    expect(sessionSuffixForStep('research')).toBe('');
  });

  it('isolates a node thread so it cannot bleed into the main conversation', () => {
    expect(sessionSuffixForStep('node:n1')).toBe('-node-n1');
    expect(sessionSuffixForStep('node:n1')).not.toBe(sessionSuffixForStep('node:n2'));
  });
});
