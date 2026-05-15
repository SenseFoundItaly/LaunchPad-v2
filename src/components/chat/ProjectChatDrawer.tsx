'use client';

import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useChat } from '@/hooks/useChat';

/**
 * Floating chat drawer — "Ask your co-founder" slide-out accessible from
 * any project page. Reuses useChat(projectId, 'chat') so the conversation
 * state is the same session as the full /chat page (shared history).
 *
 * The agent behind this drawer has access to the full project-scoped tool
 * set (list_ecosystem_alerts, list_pending_actions, list_graph_nodes,
 * get_project_metrics, get_project_summary, queue_draft_for_review)
 * plus the generic web tools (web_search, read_url, calculate).
 *
 * UX rules:
 *   - Floating trigger button at bottom-right (always visible on dashboard)
 *   - Drawer slides in from the right (420px width on desktop, fullscreen on mobile)
 *   - Enter-to-send, Shift+Enter for newline
 *   - Streaming responses render live
 *   - Escape or backdrop click to close; state persists
 */

interface ProjectChatDrawerProps {
  projectId: string;
  /** Optional starting prompt — shown as a placeholder, auto-clears on focus */
  suggestedPrompts?: string[];
  /** Label for the floating trigger. Default: "Chiedi al tuo co-founder" */
  triggerLabel?: string;
}

export interface ChatDrawerHandle {
  openAndSend: (message: string) => void;
}

const DEFAULT_SUGGESTED_PROMPTS = [
  'Cosa si è mosso nel mio ecosistema questa settimana?',
  'Riassumi i miei numeri e la mia runway',
  'Cosa ho nell\'inbox da approvare?',
  'Quali competitor ho tracciato finora?',
];

const ProjectChatDrawer = forwardRef<ChatDrawerHandle, ProjectChatDrawerProps>(function ProjectChatDrawer({
  projectId,
  suggestedPrompts = DEFAULT_SUGGESTED_PROMPTS,
  triggerLabel = 'Chiedi al tuo co-founder',
}, ref) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isStreaming, sendMessage } = useChat(projectId, 'chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingSendRef = useRef<string[]>([]);

  // Expose imperative handle for external callers (e.g. ticket click)
  useImperativeHandle(ref, () => ({
    openAndSend(message: string) {
      pendingSendRef.current.push(message);
      setOpen(true);
    },
  }));

  // Fire pending messages once the drawer is open and not streaming.
  useEffect(() => {
    if (open && pendingSendRef.current.length > 0 && !isStreaming) {
      const msg = pendingSendRef.current.shift()!;
      sendMessage(msg);
    }
  }, [open, isStreaming, sendMessage]);

  // Auto-scroll to newest message
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setInput('');
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Floating trigger */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 px-4 py-3 rounded-full bg-moss hover:bg-moss/80 text-white text-sm font-medium shadow-lg shadow-moss/30 flex items-center gap-2 transition-transform hover:scale-105"
          aria-label="Apri chat con il co-founder"
        >
          <span className="w-2 h-2 rounded-full bg-moss animate-pulse" />
          {triggerLabel}
        </button>
      )}

      {/* Drawer */}
      {open && (
        <>
          {/* Backdrop — mobile tap-to-close */}
          <div
            className="fixed inset-0 z-40 bg-black/40 md:bg-transparent md:pointer-events-none"
            onClick={() => setOpen(false)}
          />

          <aside className="fixed top-0 right-0 z-50 h-full w-full md:w-[440px] bg-surface-sunk border-l border-line flex flex-col shadow-2xl">
            {/* Header */}
            <header className="shrink-0 px-5 py-4 border-b border-line flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-ink-5">
                  Co-founder
                </div>
                <h2 className="text-sm font-semibold text-ink">
                  Parla con il tuo progetto
                </h2>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-ink-5 hover:text-ink-3 text-xl leading-none"
                aria-label="Chiudi chat"
              >
                &times;
              </button>
            </header>

            {/* Message list */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {messages.length === 0 ? (
                <EmptyState
                  suggestedPrompts={suggestedPrompts}
                  onPick={p => { setInput(p); }}
                />
              ) : (
                messages.map(m => (
                  <MessageBubble key={m.id} role={m.role} content={m.content} tools={m.tools} />
                ))
              )}
              {isStreaming && messages[messages.length - 1]?.role === 'assistant' && messages[messages.length - 1]?.content === '' && (
                <div className="text-xs text-ink-5 italic">Sto pensando…</div>
              )}
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-line px-4 py-3">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Chiedi qualcosa sul tuo progetto…"
                  rows={2}
                  disabled={isStreaming}
                  className="flex-1 resize-none px-3 py-2 text-sm bg-paper border border-line rounded-lg text-ink placeholder-ink-6 outline-none focus:border-ink-6"
                />
                <button
                  onClick={handleSend}
                  disabled={isStreaming || !input.trim()}
                  className="shrink-0 px-4 py-2 text-sm rounded-lg bg-moss hover:bg-moss/80 disabled:bg-paper-2 disabled:text-ink-6 text-white"
                  aria-label="Invia messaggio"
                >
                  {isStreaming ? '…' : 'Invia'}
                </button>
              </div>
              <div className="text-[10px] text-ink-6 mt-2">
                Invio = invia · Shift+Invio = nuova riga · ESC = chiudi
              </div>
            </div>
          </aside>
        </>
      )}
    </>
  );
});

export default ProjectChatDrawer;

// =============================================================================
// Subcomponents
// =============================================================================

function MessageBubble({
  role,
  content,
  tools,
}: {
  role: 'user' | 'assistant';
  content: string;
  tools?: Array<{ id: string; name: string; status: string }>;
}) {
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? 'bg-moss text-white rounded-br-sm'
            : 'bg-paper border border-line text-ink rounded-bl-sm'
        }`}
      >
        {/* Tool activity (above assistant content) */}
        {!isUser && tools && tools.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tools.map(t => (
              <span
                key={t.id}
                className={`text-[10px] px-2 py-0.5 rounded-full ${
                  t.status === 'running'
                    ? 'bg-sky/20 text-sky animate-pulse'
                    : t.status === 'error'
                      ? 'bg-clay/20 text-clay'
                      : 'bg-paper-2 text-ink-4'
                }`}
              >
                {t.name}
              </span>
            ))}
          </div>
        )}
        {content || (isUser ? '' : '…')}
      </div>
    </div>
  );
}

function EmptyState({
  suggestedPrompts,
  onPick,
}: {
  suggestedPrompts: string[];
  onPick: (p: string) => void;
}) {
  return (
    <div className="py-6">
      <p className="text-sm text-ink-4 mb-3">
        Parla con il tuo progetto. Ho accesso a metriche, ecosystem alert, inbox e knowledge graph — chiedimi qualsiasi cosa.
      </p>
      <div className="space-y-1.5">
        {suggestedPrompts.map(p => (
          <button
            key={p}
            onClick={() => onPick(p)}
            className="w-full text-left px-3 py-2 text-xs rounded-lg bg-paper hover:bg-paper-2 text-ink-3 border border-line transition-colors"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
