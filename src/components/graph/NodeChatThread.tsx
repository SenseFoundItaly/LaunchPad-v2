'use client';

/**
 * NodeChatThread (#330, epic #324) — an embedded co-pilot thread scoped to ONE
 * knowledge node.
 *
 * It is the main chat pipeline addressed with `step = 'node:<id>'`
 * (see src/lib/chat/node-scope.ts): same streaming route, same credits, same
 * tools, same approval gate, own server-persisted thread. Nothing here
 * duplicates chat logic — `useChat` already keys its store by (projectId, step)
 * and `/api/chat/history` already filters by step.
 *
 * Deliberately NOT a second chat page: prose only (artifact blocks are stripped
 * and the server steers against emitting them), no paging, no tool timeline.
 * Anything that outgrows a side panel belongs in the main co-pilot, which the
 * "Ask the co-pilot" deep-link above still opens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useChat, chatStoreHydrated, markChatHydrated } from '@/hooks/useChat';
import { nodeChatStep } from '@/lib/chat/node-scope';
import { useT } from '@/components/providers/LocaleProvider';
import api from '@/api';

interface HistoryRow {
  id?: string;
  role: string;
  content: string;
  timestamp?: string;
}

/** Prose only — the panel has no artifact renderer, and a leaked block would
 *  otherwise dump raw JSON into a 300px column. Mirrors the chat page's strip. */
function stripArtifactBlocks(content: string): string {
  return content.replace(/:::artifact[\s\S]*?(?::::|$)/g, '').trim();
}

export default function NodeChatThread({
  projectId,
  nodeId,
  nodeName,
}: {
  projectId: string;
  nodeId: string;
  nodeName: string;
}) {
  const t = useT();
  const step = nodeChatStep(nodeId);
  const { messages, isStreaming, sendMessage, setMessages } = useChat(projectId, step);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Hydrate from the server only once the founder actually opens the thread —
  // the panel opens on every node click, and eagerly fetching history for each
  // would be a request per click for a surface most clicks never use.
  useEffect(() => {
    if (!open) return;
    if (chatStoreHydrated(projectId, step)) return;
    const controller = new AbortController();
    api.get<{ success: boolean; data: HistoryRow[] }>(
      `/api/chat/history?project_id=${projectId}&step=${encodeURIComponent(step)}`,
      { signal: controller.signal, timeout: 15_000 },
    )
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        // A send may have started while history was in flight — never let stale
        // rows overwrite a live stream.
        if (chatStoreHydrated(projectId, step)) return;
        const rows = data.success && Array.isArray(data.data) ? data.data : [];
        setMessages(rows.map((m, i) => ({
          id: m.id ?? `restored_${i}`,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp ?? new Date().toISOString(),
        })));
        // Mark hydrated ONLY on success, so a transient failure stays reloadable
        // instead of pinning the thread empty until a full refresh.
        markChatHydrated(projectId, step);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('[node-chat] history fetch failed (stays reloadable):', (err as Error).message);
      });
    return () => controller.abort();
  }, [open, projectId, step, setMessages]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, open]);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    void sendMessage(text);
  }, [input, isStreaming, sendMessage]);

  return (
    <section style={{ border: '1px solid var(--line)', borderRadius: 6, overflow: 'hidden' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', background: 'var(--surface)', border: 'none', cursor: 'pointer',
          font: 'inherit', fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', textAlign: 'left',
        }}
        aria-expanded={open}
      >
        <span>
          {t('node-chat.title')}
          {messages.length > 0 && (
            <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--ink-5)' }}>
              {messages.length}
            </span>
          )}
        </span>
        <span style={{ color: 'var(--ink-5)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ borderTop: '1px solid var(--line)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.4, color: 'var(--ink-5)' }}>
            {t('node-chat.hint', { name: nodeName })}
          </p>

          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 && !isStreaming && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-5)' }}>{t('node-chat.empty')}</p>
            )}
            {messages.map((m) => {
              const text = m.role === 'assistant' ? stripArtifactBlocks(m.content) : m.content;
              if (!text) return null;
              return (
                <div
                  key={m.id}
                  style={{
                    fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap',
                    padding: '6px 8px', borderRadius: 6,
                    background: m.role === 'user' ? 'var(--accent-wash)' : 'var(--paper-2, var(--surface))',
                    color: m.role === 'user' ? 'var(--accent-ink)' : 'var(--ink-2)',
                    alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
                    maxWidth: m.role === 'user' ? '90%' : '100%',
                  }}
                >
                  {text}
                </div>
              );
            })}
            {isStreaming && (
              <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{t('node-chat.thinking')}</span>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={t('node-chat.placeholder')}
              disabled={isStreaming}
              style={{
                flex: 1, minWidth: 0, fontSize: 12, padding: '6px 8px',
                border: '1px solid var(--line-2)', borderRadius: 6,
                background: 'var(--surface)', color: 'var(--ink-1)',
              }}
            />
            <button
              type="button"
              onClick={submit}
              disabled={isStreaming || !input.trim()}
              style={{
                fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 6,
                border: '1px solid var(--line-2)', cursor: isStreaming || !input.trim() ? 'default' : 'pointer',
                background: 'var(--accent-wash)', color: 'var(--accent-ink)',
                opacity: isStreaming || !input.trim() ? 0.5 : 1,
              }}
            >
              {t('node-chat.send')}
            </button>
          </div>
          {/* A founder message costs credits here exactly as it does in the main
              chat — same route, same strict-billing chokepoint. Say so, rather
              than let a side panel look free. */}
          <p style={{ margin: 0, fontSize: 10, color: 'var(--ink-5)' }}>{t('node-chat.credit-note')}</p>
        </div>
      )}
    </section>
  );
}
