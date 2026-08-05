'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { ChatMessage, ToolActivity } from '@/types';
import { requestRecharge, RECHARGED_EVENT } from '@/components/credits/recharge-events';
import { broadcastPersistedArtifacts } from '@/hooks/usePersistedArtifact';

// ---------------------------------------------------------------------------
// Module-level chat store, keyed by `${projectId}::${step}`.
//
// WHY this lives OUTSIDE React: the streaming fetch + reader loop runs inside
// sendMessage. If the only copy of `messages` were component state, navigating
// away from the Co-pilot tab (to Know / Home) unmounts the chat page and the
// in-flight response is lost — the founder "loses the response" mid-stream.
// Backing the state with a module store means the loop keeps filling the store
// even while the page is unmounted; returning to the tab re-subscribes and
// shows the live (or already-completed) message. The store survives tab
// switches (the module persists for the session); a full page refresh resets
// it, at which point GET /api/chat/history rebuilds the thread from the
// server-persisted chat_messages rows.
// ---------------------------------------------------------------------------

interface ChatStoreState {
  messages: ChatMessage[];
  isStreaming: boolean;
}

interface ChatStore {
  state: ChatStoreState;
  // True once GET /api/chat/history has been loaded for this key. Lets the chat
  // page SKIP the history reload on tab-return (which would clobber an
  // in-flight / returned stream) while still loading it on first mount and
  // after a full refresh.
  hydrated: boolean;
  abort: AbortController | null;
  listeners: Set<() => void>;
}

const EMPTY_STATE: ChatStoreState = { messages: [], isStreaming: false };
const stores = new Map<string, ChatStore>();

// Messages dropped on a 402 (out of credits), keyed by store key. Stashed so a
// successful recharge can re-send them automatically — the founder shouldn't
// lose what they typed to the modal. Cleared on resend or when superseded by a
// new manual send.
const pendingResends = new Map<string, string>();

function keyFor(projectId: string, step: string): string {
  return `${projectId}::${step}`;
}

function getStore(projectId: string, step: string): ChatStore {
  const key = keyFor(projectId, step);
  let s = stores.get(key);
  if (!s) {
    s = { state: EMPTY_STATE, hydrated: false, abort: null, listeners: new Set() };
    stores.set(key, s);
  }
  return s;
}

function emit(store: ChatStore) {
  for (const l of store.listeners) l();
}

// Replace state with a shallow-merged copy (new reference) so useSyncExternalStore
// detects the change, then notify subscribers.
function patch(store: ChatStore, next: Partial<ChatStoreState>) {
  store.state = { ...store.state, ...next };
  emit(store);
}

/** Has this project's chat thread already been hydrated (history loaded, or a
 *  stream populated/running)? The chat page calls this to avoid re-loading
 *  history — and clobbering a stream — when the founder returns to the tab. */
export function chatStoreHydrated(projectId: string, step: string = 'chat'): boolean {
  const s = stores.get(keyFor(projectId, step));
  return !!s && (s.hydrated || s.state.messages.length > 0 || s.state.isStreaming);
}

/** Mark the thread hydrated (called once the chat page finishes loading history). */
export function markChatHydrated(projectId: string, step: string = 'chat') {
  getStore(projectId, step).hydrated = true;
}

export function useChat(projectId: string, step: string = 'chat') {
  const store = getStore(projectId, step);

  const subscribe = useCallback(
    (cb: () => void) => {
      store.listeners.add(cb);
      return () => { store.listeners.delete(cb); };
    },
    [store],
  );

  const state = useSyncExternalStore(subscribe, () => store.state, () => EMPTY_STATE);

  const setMessages = useCallback(
    (updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      const next = typeof updater === 'function'
        ? (updater as (prev: ChatMessage[]) => ChatMessage[])(store.state.messages)
        : updater;
      patch(store, { messages: next });
    },
    [store],
  );

  const sendMessage = useCallback(
    // `targetCheck` is the spine substep the founder pressed, when the turn
    // started from a click. Without it the server sees a generic question and a
    // flat list of open gaps, and the model closes whichever it happens to
    // batch — five gate checks measured green only SOMETIMES.
    async (content: string, targetCheck?: string | null) => {
      // A fresh manual send supersedes any message stashed for auto-resend.
      pendingResends.delete(keyFor(projectId, step));
      // Read the live store (not a stale closure) so concurrent mounts agree.
      const currentMessages = store.state.messages;

      const userMsg: ChatMessage = {
        id: `msg_${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      };
      const updatedMessages = [...currentMessages, userMsg];
      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        tools: [],
      };
      patch(store, { messages: [...updatedMessages, assistantMsg], isStreaming: true });

      // Mutate the trailing (assistant) message in the live store.
      const setLast = (mut: (m: ChatMessage) => ChatMessage) => {
        const msgs = store.state.messages;
        if (msgs.length === 0) return;
        const updated = [...msgs];
        updated[updated.length - 1] = mut(updated[updated.length - 1]);
        patch(store, { messages: updated });
      };

      // ── Delta coalescing ─────────────────────────────────────────────────
      // A setLast() per token meant one React render per token, and every
      // render re-parses artifacts across the whole conversation — so the
      // stream started smooth and degraded as the answer and history grew.
      // Tokens now accumulate in `fullContent` and paint at most once per
      // animation frame: same words, evenly paced, a fraction of the renders.
      //
      // Declared OUTSIDE the try so the catch/finally can force a final paint:
      // rAF is PAUSED in background tabs and a queued frame may never run, so
      // it must never be the only path to the final state.
      let fullContent = '';
      let toolsList: ToolActivity[] = [];
      let rafId: number | null = null;
      const paint = () => {
        setLast((m) => ({
          ...m,
          content: fullContent,
          tools: toolsList.length > 0 ? [...toolsList] : undefined,
        }));
      };
      const schedulePaint = () => {
        if (rafId !== null) return; // a paint is already queued for this frame
        if (typeof requestAnimationFrame !== 'function') { paint(); return; }
        rafId = requestAnimationFrame(() => { rafId = null; paint(); });
      };
      const flushNow = () => {
        if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
        rafId = null;
        if (fullContent) paint(); // nothing streamed ⇒ leave the placeholder alone
      };

      try {
        store.abort = new AbortController();
        const response = await fetch(`/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            step,
            messages: updatedMessages.map((m) => ({ role: m.role, content: m.content })),
            ...(targetCheck ? { target_check: targetCheck } : {}),
          }),
          signal: store.abort.signal,
        });

        if (!response.ok) {
          // Hard-stop: out of credits → open the recharge modal instead of
          // showing a raw error. The server returns a clean JSON 402 BEFORE the
          // stream opens, so there's no partial assistant content to keep.
          if (response.status === 402) {
            const body = await response.json().catch(() => null);
            if (body?.error === 'out_of_credits') {
              // Stash what they typed so a successful recharge auto-resends it —
              // losing the message to the modal is the bug. Then drop the
              // optimistic user+assistant placeholders (the turn never started)
              // and open the recharge modal.
              pendingResends.set(keyFor(projectId, step), content);
              requestRecharge({ remaining: body.credits_remaining ?? 0 });
              patch(store, { messages: currentMessages });
              return;
            }
          }
          const errorText = await response.text();
          console.error('Chat API error:', response.status, errorText);
          setLast((m) => ({ ...m, content: `Error: ${response.status} - ${errorText}` }));
          return;
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        // SSE line buffer: accumulates partial lines across chunk boundaries.
        let lineBuffer = '';

        // Process one complete SSE line. Extracted so the post-`done` flush
        // (below) reuses the EXACT same path — otherwise a final `data:` line
        // not terminated by a newline stays stuck in lineBuffer and is dropped,
        // truncating the tail of the response.
        const handleSseLine = (line: string) => {
          if (!line.startsWith('data: ')) return;
          try {
            const parsed = JSON.parse(line.slice(6));

            if (parsed.content) {
              fullContent += parsed.content;
              schedulePaint(); // coalesced to one render per frame
            }

            if (parsed.tool_start) {
              toolsList = [
                ...toolsList.map((t) => (t.status === 'running' ? { ...t, status: 'done' as const } : t)),
                {
                  id: parsed.tool_start.id,
                  name: parsed.tool_start.name,
                  args: parsed.tool_start.args,
                  status: 'running',
                },
              ];
              flushNow(); // tool chips are rare + high-signal: paint at once
            }

            if (parsed.tool_end) {
              toolsList = toolsList.map((t) =>
                t.id === parsed.tool_end.id
                  ? { ...t, status: parsed.tool_end.error ? 'error' as const : 'done' as const }
                  : t,
              );
              flushNow();
            }

            // Broadcast persisted artifact IDs so cards can wire apply/reject
            // (registry-backed, so late-mounting cards resolve too).
            if (parsed.done && parsed.persisted_artifacts && typeof window !== 'undefined') {
              broadcastPersistedArtifacts(parsed.persisted_artifacts);
            }

            // The agent mutated the inbox this turn (dismissed/proposed a watcher,
            // created a task, …). Refresh the Inbox badge + Watchers/Actions panels
            // so they don't show stale rows. Per-project detail scopes the bridge.
            if (parsed.done && parsed.inbox_changed && typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('lp-actions-changed', { detail: { projectId } }),
              );
            }

            if (parsed.error) {
              console.error('Stream error:', parsed.error);
              flushNow(); // land whatever streamed before surfacing the error
              setLast((m) => ({ ...m, content: fullContent + `\n\n[Error: ${parsed.error}]` }));
            }
          } catch (parseErr) {
            console.warn('[useChat] malformed SSE line:', line.slice(0, 200), parseErr);
          }
        };

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) { break; }

            const text = decoder.decode(value, { stream: true });
            lineBuffer += text;
            const lines = lineBuffer.split('\n');
            lineBuffer = lines.pop() ?? '';

            for (const line of lines) handleSseLine(line);
          }
          // Stream ended: flush any pending decoder bytes + process whatever
          // remains in lineBuffer (a last line with no trailing newline).
          lineBuffer += decoder.decode();
          if (lineBuffer) for (const line of lineBuffer.split('\n')) handleSseLine(line);
        }
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          console.error('Chat error:', err);
          flushNow(); // don't lose the partial answer behind the error
          setLast((m) => ({ ...m, content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}` }));
        }
      } finally {
        // ALWAYS land the final text — a queued animation frame may never run
        // (stream finished mid-frame, tab backgrounded, or the turn aborted),
        // and the last tokens must not be stranded in `fullContent`.
        flushNow();
        patch(store, { isStreaming: false });
        store.abort = null;
      }
    },
    [store, projectId, step],
  );

  // Auto-resend after a successful recharge: if a send for THIS thread was
  // dropped on a 402, re-send the stashed message once credits land. A ref keeps
  // the listener pointed at the latest sendMessage without re-binding each render.
  const sendRef = useRef(sendMessage);
  sendRef.current = sendMessage;
  useEffect(() => {
    const key = keyFor(projectId, step);
    const onRecharged = () => {
      const pending = pendingResends.get(key);
      if (pending) {
        pendingResends.delete(key);
        void sendRef.current(pending);
      }
    };
    window.addEventListener(RECHARGED_EVENT, onRecharged);
    return () => window.removeEventListener(RECHARGED_EVENT, onRecharged);
  }, [projectId, step]);

  const stopStreaming = useCallback(() => {
    store.abort?.abort();
    patch(store, { isStreaming: false });
  }, [store]);

  const clearMessages = useCallback(() => {
    patch(store, { messages: [] });
  }, [store]);

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    sendMessage,
    stopStreaming,
    clearMessages,
    setMessages,
  };
}
