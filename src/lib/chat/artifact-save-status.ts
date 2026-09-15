import { isDiscussionOnly } from './discussion-policy';

/**
 * Where a knowledge card (insight / entity / comparison / metric) stands with
 * respect to the proposal record its Apply / Dismiss controls act on.
 *
 * WHY this exists: the card used to read "no persisted_id" as "save in flight"
 * with nothing that could ever end that state. But a record id reaches a card
 * only through broadcastPersistedArtifacts, fired by exactly two things — the
 * chat route's final done frame and a skill run's result. Once neither is
 * pending, no id is coming, and a card that still says "Saving proposal…"
 * is promising work that will never happen. A discussion-only turn (#485)
 * hit this on every card: persistence is skipped by design.
 *
 *   saved            the card has a record id — controls work.
 *   saving           no id yet, and its turn is still streaming: the done
 *                    frame that carries the id has not arrived.
 *   discussion-only  the founder asked for discussion only. The server skips
 *                    persistence for that turn, so no record will ever exist.
 *   unlinked         the turn is finished and no id reached this view: a
 *                    reload (ids are not re-hydrated), a persist that
 *                    returned nothing, or a card outside the chat thread.
 *                    The controls cannot work here; whether a proposal exists
 *                    is not knowable client-side, so say neither.
 *
 * Signals, not timers. "Not yet" vs "finished" is the chat store's own
 * isStreaming, which useChat clears only AFTER broadcasting the final done
 * frame's ids. "Never" is isDiscussionOnly — the same pure function the chat
 * route runs, on the same founder transcript — so it holds live, after a
 * reload and in the discussion UX fixture, with nothing new to persist.
 * Discussion-only is checked first: such a card must not say "Saving…" even
 * while its own turn is still streaming.
 */
export type ArtifactSaveStatus = 'saved' | 'saving' | 'discussion-only' | 'unlinked';

interface ThreadMessage {
  role: string;
  content: string;
}

export function artifactSaveStatus(input: {
  artifactId: string | undefined;
  persistedId: string | undefined;
  messages: ReadonlyArray<ThreadMessage>;
  isStreaming: boolean;
}): ArtifactSaveStatus {
  const { artifactId, persistedId, messages, isStreaming } = input;
  if (persistedId) return 'saved';
  // The persisted-artifact registry is keyed by client artifact id; a card
  // without one can never be resolved.
  if (!artifactId) return 'unlinked';

  const owner = owningAssistantIndex(messages, artifactId);
  if (owner < 0) return 'unlinked';

  let founder = -1;
  for (let i = owner - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { founder = i; break; }
  }
  if (founder >= 0 && isDiscussionOnly(messages[founder].content, messages.slice(0, founder))) {
    return 'discussion-only';
  }

  // The in-flight turn is everything after the latest founder message.
  // Not "the last message": follow-ups merge by timestamp and can land after
  // the reply that is still streaming.
  if (isStreaming) {
    let lastFounder = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { lastFounder = i; break; }
    }
    if (owner > lastFounder) return 'saving';
  }
  return 'unlinked';
}

/** Latest assistant message whose artifact JSON carries this exact id. Latest,
 *  because a later turn can re-emit an id (solve-progress does) and the newest
 *  copy is the one on screen. */
function owningAssistantIndex(messages: ReadonlyArray<ThreadMessage>, artifactId: string): number {
  const quoted = JSON.stringify(artifactId);
  const marker = new RegExp(`"id"\\s*:\\s*${quoted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'assistant' || typeof m.content !== 'string') continue;
    // includes() first: this runs per card on every streamed delta.
    if (m.content.includes(artifactId) && marker.test(m.content)) return i;
  }
  return -1;
}
