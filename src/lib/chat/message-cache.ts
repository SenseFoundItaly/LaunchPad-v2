/** Object identity follows immutable chat messages. Historical messages remain
 * cached while mounted; partial stream revisions are weakly held and cannot
 * evict completed messages. No global string FIFO or 300-message cliff. */
export function createMessageCache<T>() {
  const cache = new WeakMap<object, { content: string; value: T }>();
  return (message: { content: string }, compute: (content: string) => T): T => {
    const hit = cache.get(message);
    if (hit?.content === message.content) return hit.value;
    const value = compute(message.content);
    cache.set(message, { content: message.content, value });
    return value;
  };
}
