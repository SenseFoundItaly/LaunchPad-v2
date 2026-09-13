import type { ChatMessage } from '@/types';

/** Server-authored follow-ups have durable IDs. Never replace a live reply or
 * match by text: two separate decisions may have identical wording. */
export function mergeChatFollowups(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(current.map((m) => m.id));
  const additions = incoming.filter((m) => {
    if (!m.id || m.role !== 'assistant' || typeof m.content !== 'string' || seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (!additions.length) return current;
  return [...current, ...additions].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}
