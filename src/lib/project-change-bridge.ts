import { EVENT_TO_TOPICS } from './query-events';

export interface ChangeChannel {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
  close(): void;
}

/** Carry invalidations, never project data, between same-origin browser tabs.
 * Re-dispatch remote changes so chat follow-ups and approval cards reconcile
 * through their existing listeners as well as the query cache. */
export function installProjectChangeBridge(
  target: EventTarget,
  invalidate: (topic: string, projectId?: string) => void,
  channel?: ChangeChannel,
) {
  const handlers: Array<[string, EventListener]> = [];
  const remoteEvents = new WeakSet<Event>();
  const refresh = () => {
    for (const topic of new Set([...Object.values(EVENT_TO_TOPICS).flat(), 'resolved-actions'])) invalidate(topic);
  };
  for (const [name, topics] of Object.entries(EVENT_TO_TOPICS)) {
    const handler: EventListener = event => {
      const detail = (event as CustomEvent<{ projectId?: unknown }>).detail;
      const projectId = typeof detail?.projectId === 'string' ? detail.projectId : undefined;
      for (const topic of topics) invalidate(topic, projectId);
      if (!remoteEvents.has(event)) {
        // Storage/privacy restrictions must not break local invalidation.
        try { channel?.postMessage({ name, projectId }); } catch { /* focus/reconnect recovers */ }
      }
    };
    target.addEventListener(name, handler);
    handlers.push([name, handler]);
  }
  if (channel) channel.onmessage = event => {
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.name !== 'string'
      || !Object.hasOwn(EVENT_TO_TOPICS, data.name)
      || (data.projectId !== undefined && typeof data.projectId !== 'string')) return;
    const change = new CustomEvent(data.name, { detail: { projectId: data.projectId } });
    remoteEvents.add(change);
    target.dispatchEvent(change);
  };
  // Infinite-stale caches otherwise survive missed broadcasts, another device,
  // or work completed while this tab was offline. Inactive queries become stale
  // and refetch on their next mount; active queries refetch immediately.
  target.addEventListener('focus', refresh);
  target.addEventListener('online', refresh);
  return () => {
    for (const [name, handler] of handlers) target.removeEventListener(name, handler);
    target.removeEventListener('focus', refresh);
    target.removeEventListener('online', refresh);
    if (channel) { channel.onmessage = null; channel.close(); }
  };
}
