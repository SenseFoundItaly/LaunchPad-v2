import { describe, it, expect } from 'vitest';
import { buildSplitUserTurn } from '@/lib/chat-cache-split';

// Lever 1 quality gate: when the flag flips on, the model MUST still receive
// every dynamic block + steering line (only repositioned into the user turn).
// Dropping any of them silently regresses answer quality — these forbid that.
const dynamicContext = '[JOURNEY STAGE] Stage 2\n[CURRENT IDEA CANVAS] problem: X\n[MEMORY] fact A';
const trailingSteer = '\n\n[PREREQUISITE GATE] scoring unavailable\n\n[NUDGE] do not fabricate';
const lastMessage = 'help me size the market';

describe('buildSplitUserTurn', () => {
  it('CONTENT-PRESERVING: every context block + steering line + the founder message survive', () => {
    const out = buildSplitUserTurn(dynamicContext, trailingSteer, lastMessage);
    for (const piece of ['[JOURNEY STAGE] Stage 2', 'CURRENT IDEA CANVAS', '[MEMORY] fact A', '[PREREQUISITE GATE]', '[NUDGE]', lastMessage]) {
      expect(out).toContain(piece);
    }
  });

  it('recency: steering sits AFTER context and the founder message is LAST', () => {
    const out = buildSplitUserTurn(dynamicContext, trailingSteer, lastMessage);
    const idxCtx = out.indexOf('[JOURNEY STAGE]');
    const idxSteer = out.indexOf('[NUDGE]');
    const idxMsg = out.indexOf(lastMessage);
    expect(idxCtx).toBeGreaterThanOrEqual(0);
    expect(idxSteer).toBeGreaterThan(idxCtx);
    expect(idxMsg).toBeGreaterThan(idxSteer);
  });

  it('fences the founder message so the model knows where the real input starts', () => {
    const out = buildSplitUserTurn(dynamicContext, trailingSteer, lastMessage);
    expect(out).toContain('[END CONTEXT]');
    expect(out.indexOf('[END CONTEXT]')).toBeLessThan(out.indexOf(lastMessage));
  });

  it('empty context/steer → passthrough (no fence, no wasted tokens)', () => {
    expect(buildSplitUserTurn('', '', lastMessage)).toBe(lastMessage);
    expect(buildSplitUserTurn('   ', '\n\n', lastMessage)).toBe(lastMessage);
  });
});
