import { describe, expect, it, vi } from 'vitest';
import { installProjectChangeBridge, type ChangeChannel } from './project-change-bridge';

function channelPair() {
  const first: ChangeChannel = { onmessage: null, postMessage: vi.fn(value => second.onmessage?.(new MessageEvent('message', { data: value }))), close: vi.fn() };
  const second: ChangeChannel = { onmessage: null, postMessage: vi.fn(value => first.onmessage?.(new MessageEvent('message', { data: value }))), close: vi.fn() };
  return { first, second };
}

describe('project changes across tabs', () => {
  it('refreshes the same project in both tabs and notifies card listeners without rebroadcast loops', () => {
    const a = new EventTarget(), b = new EventTarget();
    const { first, second } = channelPair();
    const invalidateA = vi.fn(), invalidateB = vi.fn(), card = vi.fn();
    const stopA = installProjectChangeBridge(a, invalidateA, first);
    const stopB = installProjectChangeBridge(b, invalidateB, second);
    b.addEventListener('lp-actions-changed', card);
    a.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId: 'project-a' } }));
    expect(invalidateA).toHaveBeenCalledWith('idea-canvas', 'project-a');
    expect(invalidateB).toHaveBeenCalledWith('stages', 'project-a');
    expect(invalidateB.mock.calls.every(([, project]) => project === 'project-a')).toBe(true);
    expect(card).toHaveBeenCalledTimes(1);
    expect(first.postMessage).toHaveBeenCalledTimes(1);
    expect(second.postMessage).not.toHaveBeenCalled();
    stopA(); stopB();
  });

  it('recovers missed updates on return and reconnect even without BroadcastChannel', () => {
    const target = new EventTarget(), invalidate = vi.fn();
    const stop = installProjectChangeBridge(target, invalidate);
    for (const name of ['focus', 'online']) {
      invalidate.mockClear();
      target.dispatchEvent(new Event(name));
      expect(invalidate).toHaveBeenCalledWith('idea-canvas');
      expect(invalidate).toHaveBeenCalledWith('resolved-actions');
      expect(invalidate.mock.calls.filter(([topic]) => topic === 'stages')).toHaveLength(1);
    }
    stop();
    invalidate.mockClear();
    target.dispatchEvent(new Event('focus'));
    target.dispatchEvent(new CustomEvent('lp-actions-changed'));
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('ignores invalid messages and closes the channel on unmount', () => {
    const { first } = channelPair();
    const invalidate = vi.fn();
    const stop = installProjectChangeBridge(new EventTarget(), invalidate, first);
    for (const data of [null, {}, { name: 'unknown' }, { name: '__proto__' }, { name: 'lp-actions-changed', projectId: {} }]) {
      first.onmessage?.(new MessageEvent('message', { data }));
    }
    expect(invalidate).not.toHaveBeenCalled();
    stop();
    expect(first.onmessage).toBeNull();
    expect(first.close).toHaveBeenCalledOnce();
  });

  it('keeps local updates working when broadcasts fail', () => {
    const target = new EventTarget(), invalidate = vi.fn();
    const { first } = channelPair();
    first.postMessage = () => { throw new Error('Unavailable'); };
    const stop = installProjectChangeBridge(target, invalidate, first);
    target.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId: 'p1' } }));
    expect(invalidate).toHaveBeenCalledWith('stages', 'p1');
    stop();
  });
});
