'use client';

/**
 * Co-pilot + Canvas — ported from screen-chat.jsx.
 *
 * Two-pane: 440px chat left, flex artifact canvas right.
 *
 * Replaces the previous multi-mode sidebar chat. The new chrome is simpler:
 *   - Messages in left column, tool activity + streaming cursor inline
 *   - Canvas on right renders artifacts parsed from the latest assistant
 *     message (via src/lib/artifact-parser.ts)
 *
 * Data flows from useChat (project-scoped tools already wired via PR #8/#9).
 * The agent can list_ecosystem_alerts, get_project_metrics, queue_draft_for_approval, etc.
 * without changing this component.
 */

import { use, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import api from '@/api';
import { useChat } from '@/hooks/useChat';
import { useProject } from '@/hooks/useProject';
import { parseMessageContent } from '@/lib/artifact-parser';
import type { Artifact } from '@/types/artifacts';
import { TopBar, NavRail } from '@/components/design/chrome';
import {
  Pill,
  StatusBar,
  Icon,
  I,
  IconBtn,
} from '@/components/design/primitives';

interface HistoryResp {
  success: boolean;
  data?: Array<{ role: string; content: string; timestamp: string }>;
}

export default function CopilotChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { project } = useProject(projectId);
  const { messages, isStreaming, sendMessage, setMessages } = useChat(projectId, 'chat');
  const [input, setInput] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const locale = (project as unknown as { locale?: string })?.locale === 'it' ? 'it' : 'en';

  // Load existing chat history
  useEffect(() => {
    api.get<HistoryResp>(`/api/chat/history?project_id=${projectId}&step=chat`)
      .then(({ data }) => {
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
          setMessages(
            data.data.map((m, i) => ({
              id: `restored_${i}`,
              role: m.role as 'user' | 'assistant',
              content: m.content,
              timestamp: m.timestamp,
            })),
          );
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [projectId, setMessages]);

  // Auto-scroll to newest
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Parse artifacts from the most recent assistant message
  const canvasArtifacts = useMemo<Artifact[]>(() => {
    const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content);
    if (assistantMessages.length === 0) return [];
    const latest = assistantMessages[assistantMessages.length - 1];
    const segments = parseMessageContent(latest.content);
    return segments
      .filter(s => s.type === 'artifact')
      .map(s => (s as { type: 'artifact'; artifact: Artifact }).artifact);
  }, [messages]);

  function handleSend() {
    const v = input.trim();
    if (!v || isStreaming) return;
    sendMessage(v);
    setInput('');
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={[project?.name || 'Project', 'Co-pilot']}
        right={
          <>
            {isStreaming && <Pill kind="live" dot>streaming</Pill>}
            <span className="lp-mono" style={{ fontSize: 10 }}>
              ctx · {messages.length} msgs
            </span>
          </>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="chat" />

        {/* Chat column */}
        <div
          style={{
            width: 440,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--paper)',
          }}
        >
          <ChatHeader project={project} locale={locale} />

          <div
            ref={scrollRef}
            className="lp-scroll"
            style={{ flex: 1, overflow: 'auto', padding: '16px 20px 20px' }}
          >
            {!historyLoaded && messages.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: 20, textAlign: 'center' }}>
                Loading history…
              </div>
            ) : messages.length === 0 ? (
              <ChatEmptyState
                locale={locale}
                onPick={(s) => setInput(s)}
              />
            ) : (
              messages.map((m) => (
                <Msg
                  key={m.id}
                  who={m.role === 'user' ? 'user' : 'ai'}
                  agent="Chief"
                  streaming={m.role === 'assistant' && isStreaming && m === messages[messages.length - 1]}
                  tools={m.tools}
                  rawContent={m.content}
                  // Retry only for user messages; disabled while streaming
                  // to prevent double-sends. Reuses sendMessage so the
                  // retried turn goes through the same memory-context +
                  // cost-throttle + skill-tools pipeline as a fresh send.
                  onRetry={
                    m.role === 'user' && !isStreaming ? sendMessage : undefined
                  }
                >
                  {stripArtifacts(m.content)}
                </Msg>
              ))
            )}
          </div>

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onKeyDown={handleKey}
            disabled={isStreaming}
            locale={locale}
          />
        </div>

        {/* Canvas */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            background: 'var(--paper-2)',
          }}
        >
          <CanvasHeader count={canvasArtifacts.length} locale={locale} />
          <div
            className="lp-scroll"
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 20,
              display: 'grid',
              gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 14,
              alignContent: 'start',
            }}
          >
            {canvasArtifacts.length === 0 ? (
              <CanvasEmptyState locale={locale} />
            ) : (
              canvasArtifacts.map((a, i) => <ArtifactCard key={i} artifact={a} />)
            )}
          </div>
        </div>
      </div>

      <StatusBar
        heartbeatLabel={isStreaming ? 'streaming' : 'heartbeat · idle'}
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${messages.length} msgs`}
        budget={`${canvasArtifacts.length} artifact${canvasArtifacts.length === 1 ? '' : 's'}`}
      />
    </div>
  );
}

// =============================================================================
// Chat header + empty + composer + message
// =============================================================================

function ChatHeader({
  project,
  locale,
}: {
  project: unknown;
  locale: 'en' | 'it';
}) {
  const p = project as { name?: string; description?: string } | null;
  return (
    <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Pill kind="live" dot>
          {locale === 'it' ? 'loop · discovery clienti' : 'loop · customer discovery'}
        </Pill>
      </div>
      <h2
        className="lp-serif"
        style={{ fontSize: 20, fontWeight: 400, letterSpacing: -0.3, margin: 0 }}
      >
        {p?.name || 'Your project'}
      </h2>
      <div
        style={{
          fontSize: 11,
          color: 'var(--ink-4)',
          marginTop: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span className="lp-mono">
          {locale === 'it' ? 'obiettivo · validare ICP' : 'goal · validate ICP'}
        </span>
        <span>·</span>
        <span>chief · scout · analyst · outreach</span>
      </div>
    </div>
  );
}

function ChatEmptyState({
  locale,
  onPick,
}: {
  locale: 'en' | 'it';
  onPick: (s: string) => void;
}) {
  const prompts = locale === 'it'
    ? [
      'Cosa si è mosso nel mio ecosistema questa settimana?',
      'Riassumi i miei numeri e la mia runway',
      'Cosa ho nell\'inbox da approvare?',
      'Quali competitor ho tracciato finora?',
    ]
    : [
      'What moved in my ecosystem this week?',
      'Summarize my numbers and runway',
      'What do I have in my inbox?',
      'Which competitors am I tracking?',
    ];

  return (
    <div style={{ padding: '10px 0' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        {locale === 'it'
          ? 'Chiedi al co-pilot qualsiasi cosa sul tuo progetto. Ho accesso a metriche, ecosystem alert, inbox e knowledge graph.'
          : 'Ask your co-pilot anything about your project. I have access to metrics, ecosystem alerts, inbox, and the knowledge graph.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompts.map((p) => (
          <button
            key={p}
            onClick={() => onPick(p)}
            style={{
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 'var(--r-m)',
              border: '1px solid var(--line-2)',
              background: 'var(--surface)',
              color: 'var(--ink-2)',
              fontSize: 12.5,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Msg({
  who,
  agent,
  streaming,
  tools,
  children,
  rawContent,
  onRetry,
}: {
  who: 'user' | 'ai';
  agent: string;
  streaming?: boolean;
  tools?: Array<{ id: string; name: string; status: string }>;
  children: React.ReactNode;
  /** Raw text for clipboard + retry. User sees `children` (stripped);
   *  clipboard + retry use the original `rawContent`. */
  rawContent: string;
  /** Provided only for user messages to resubmit. Undefined while streaming. */
  onRetry?: (content: string) => void;
}) {
  if (who === 'user') {
    return (
      <div
        className="lp-msg-row"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginBottom: 16 }}
      >
        <div
          style={{
            maxWidth: '82%',
            padding: '9px 12px',
            borderRadius: 12,
            background: 'var(--ink)',
            color: 'var(--paper)',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {children}
        </div>
        <MsgActions content={rawContent} onRetry={onRetry} align="right" />
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: '#4a5a7a',
            color: '#fff',
            fontSize: 9,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--f-mono)',
          }}
        >
          {agent.slice(0, 2).toUpperCase()}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{agent}</span>
        {streaming && <Pill kind="live" dot>streaming</Pill>}
      </div>
      {tools && tools.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {tools.map((t) => (
            <span
              key={t.id}
              className="lp-chip"
              style={{
                background: t.status === 'running'
                  ? 'var(--accent-wash)'
                  : t.status === 'error'
                    ? 'oklch(0.94 0.05 40)'
                    : 'var(--paper-2)',
                color: t.status === 'running'
                  ? 'var(--accent-ink)'
                  : t.status === 'error'
                    ? 'var(--clay)'
                    : 'var(--ink-4)',
              }}
            >
              {t.status === 'running' && (
                <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
              )}
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div
        className="lp-msg-row"
        style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}
      >
        {children}
      </div>
      {!streaming && <MsgActions content={rawContent} align="left" />}
    </div>
  );
}

/**
 * Small copy/retry pill row shown under a message bubble.
 * Hover-reveal only (parent div must have `lp-msg-row` class alongside the
 * actions — see the .lp-msg-row:hover CSS below).
 *
 * - Copy: writes `content` to clipboard, 1.3s "Copied" confirmation.
 * - Retry: only when onRetry is provided (user messages, not streaming).
 */
function MsgActions({
  content,
  onRetry,
  align,
}: {
  content: string;
  onRetry?: (content: string) => void;
  align: 'left' | 'right';
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1300);
    } catch {
      // Older browsers / insecure context — fail silently.
    }
  }

  return (
    <div
      className="lp-msg-actions"
      style={{
        display: 'flex',
        gap: 4,
        marginTop: 4,
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        opacity: 0,
        transition: 'opacity 120ms ease',
      }}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy message'}
        className="lp-msg-action-btn"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '3px 7px',
          fontSize: 11,
          lineHeight: 1,
          color: 'var(--ink-5)',
          background: 'transparent',
          border: '1px solid var(--line)',
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        {copied ? (
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            Copied
          </>
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            Copy
          </>
        )}
      </button>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry(content)}
          title="Resend this message"
          className="lp-msg-action-btn"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 7px',
            fontSize: 11,
            lineHeight: 1,
            color: 'var(--ink-5)',
            background: 'transparent',
            border: '1px solid var(--line)',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><polyline points="21 3 21 9 15 9" /></svg>
          Retry
        </button>
      )}
    </div>
  );
}

function ChatComposer({
  value,
  onChange,
  onSend,
  onKeyDown,
  disabled,
  locale,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  locale: 'en' | 'it';
}) {
  return (
    <div style={{ borderTop: '1px solid var(--line)', padding: 14, background: 'var(--surface)' }}>
      <div
        style={{
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-m)',
          padding: 10,
          background: 'var(--paper)',
        }}
      >
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={locale === 'it' ? 'Chiedi al co-pilot…' : 'Ask the co-pilot…'}
          rows={2}
          disabled={disabled}
          style={{
            width: '100%',
            border: 'none',
            background: 'transparent',
            outline: 'none',
            resize: 'none',
            fontSize: 13,
            color: 'var(--ink-2)',
            fontFamily: 'inherit',
            lineHeight: 1.5,
            padding: 0,
            minHeight: 40,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <IconBtn d={I.plus} size={24} title="attach" />
          <IconBtn d={I.sparkles} size={24} title="suggest" />
          <IconBtn d={I.terminal} size={24} title="cmd" />
          <span style={{ flex: 1 }} />
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            claude-sonnet-4
          </span>
          <button
            onClick={onSend}
            disabled={disabled || !value.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 'var(--r-m)',
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'var(--f-sans)',
              fontWeight: 500,
              opacity: disabled || !value.trim() ? 0.5 : 1,
            }}
          >
            <Icon d={I.send} size={12} /> {disabled ? '…' : 'send'}
            <span
              className="lp-kbd"
              style={{
                background: 'rgba(255,255,255,.12)',
                borderColor: 'rgba(255,255,255,.2)',
                color: 'var(--paper)',
              }}
            >
              ⌘↵
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Canvas
// =============================================================================

function CanvasHeader({ count, locale }: { count: number; locale: 'en' | 'it' }) {
  return (
    <div
      style={{
        height: 40,
        flexShrink: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600 }}>Canvas</span>
      <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
        {count === 0
          ? (locale === 'it' ? 'nessun artefatto ancora' : 'no artifacts yet')
          : `${count} artifact${count === 1 ? '' : 's'}`}
      </span>
      <span style={{ flex: 1 }} />
      <Pill kind="n">view · grid</Pill>
      <IconBtn d={I.filter} title="filter" />
      <IconBtn d={I.more} title="more" />
    </div>
  );
}

function CanvasEmptyState({ locale }: { locale: 'en' | 'it' }) {
  return (
    <div
      style={{
        gridColumn: 'span 6',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        padding: 60,
        color: 'var(--ink-4)',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      <Icon d={I.layers} size={32} style={{ opacity: 0.4 }} />
      <h3 className="lp-serif" style={{ fontSize: 18, fontWeight: 400, margin: 0, color: 'var(--ink-3)' }}>
        {locale === 'it' ? 'Il canvas è vuoto.' : 'Canvas is empty.'}
      </h3>
      <p style={{ margin: 0, maxWidth: 400, lineHeight: 1.5 }}>
        {locale === 'it'
          ? 'Gli artefatti del co-pilot (entity card, tabelle, grafici, insight, opzioni) appariranno qui man mano che rispondo alle tue domande.'
          : 'Co-pilot artifacts (entity cards, tables, charts, insights, options) appear here as I respond to your questions.'}
      </p>
    </div>
  );
}

// =============================================================================
// Artifact card — unified renderer for ALL artifact types
// =============================================================================

function ArtifactCard({ artifact }: { artifact: Artifact }) {
  // Each artifact takes 2 cols by default, 6 for wide tables/workflows
  const wide = artifact.type === 'comparison-table' || artifact.type === 'workflow-card';
  const span = wide ? 6 : 2;

  const name = (() => {
    const a = artifact as unknown as { name?: string; title?: string; category?: string };
    return a.name || a.title || a.category || humanizeType(artifact.type);
  })();

  const iconMap: Record<string, string> = {
    'entity-card': I.users,
    'comparison-table': I.layers,
    'insight-card': I.bolt,
    'option-set': I.layers,
    'workflow-card': I.pipe,
    'score-card': I.shield,
    'radar-chart': I.graph,
    'bar-chart': I.fund,
    'pie-chart': I.fund,
    'gauge-chart': I.globe,
    'metric-grid': I.sliders,
    'sensitivity-slider': I.sliders,
    'action-suggestion': I.sparkles,
  };

  return (
    <div className="lp-card" style={{ gridColumn: `span ${span}` }}>
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Icon
          d={iconMap[artifact.type] || I.file}
          size={13}
          style={{ color: 'var(--accent)' }}
        />
        <span style={{ fontSize: 12, fontWeight: 600 }}>{name}</span>
        <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>
          {humanizeType(artifact.type)}
        </span>
        <span style={{ flex: 1 }} />
        <Icon d={I.more} size={13} style={{ color: 'var(--ink-5)' }} />
      </div>
      <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-3)' }}>
        <ArtifactBody artifact={artifact} />
      </div>
    </div>
  );
}

function ArtifactBody({ artifact }: { artifact: Artifact }) {
  const a = artifact as unknown as Record<string, unknown>;

  if (artifact.type === 'entity-card') {
    return (
      <div>
        {typeof a.summary === 'string' ? (
          <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.5 }}>{a.summary}</p>
        ) : null}
        {a.entity_type ? (
          <div style={{ marginTop: 8 }}>
            <Pill kind="warn">{String(a.entity_type)}</Pill>
          </div>
        ) : null}
      </div>
    );
  }

  if (artifact.type === 'insight-card') {
    return (
      <div>
        <p
          className="lp-serif"
          style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}
        >
          &ldquo;{String(a.body || a.insight || '—')}&rdquo;
        </p>
        {a.category ? (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--ink-5)' }}>
            — {String(a.category)}
          </div>
        ) : null}
      </div>
    );
  }

  if (artifact.type === 'score-card' || artifact.type === 'gauge-chart') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div className="lp-serif" style={{ fontSize: 32, fontWeight: 400, color: 'var(--ink)' }}>
          {String(a.score ?? a.value ?? '—')}
          <span style={{ fontSize: 14, color: 'var(--ink-5)' }}>/{String(a.maxScore ?? 10)}</span>
        </div>
        {a.verdict ? (
          <Pill kind={a.verdict === 'GO' || a.verdict === 'STRONG GO' ? 'ok' : 'warn'}>
            {String(a.verdict)}
          </Pill>
        ) : null}
        {a.description ? (
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 8 }}>
            {String(a.description)}
          </div>
        ) : null}
      </div>
    );
  }

  if (artifact.type === 'comparison-table' && Array.isArray(a.rows) && Array.isArray(a.columns)) {
    const cols = a.columns as string[];
    const rows = a.rows as Array<{ label?: string; values?: unknown[] }>;
    return (
      <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              color: 'var(--ink-5)',
              textAlign: 'left',
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              textTransform: 'uppercase',
            }}
          >
            <th style={{ padding: '6px 10px' }}></th>
            {cols.map((c) => (
              <th key={c} style={{ padding: '6px 10px' }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid var(--line)' }}>
              <td style={{ padding: '6px 10px', fontWeight: 500 }}>{r.label || '—'}</td>
              {(r.values || []).map((v, j) => (
                <td key={j} style={{ padding: '6px 10px', color: 'var(--ink-2)' }}>
                  {String(v ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (artifact.type === 'option-set' && Array.isArray(a.options)) {
    const options = a.options as Array<{ label?: string; description?: string; id?: string }>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((o, i) => (
          <div
            key={o.id || i}
            style={{
              padding: 10,
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-m)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>
              {o.label || `Option ${i + 1}`}
            </div>
            {o.description && (
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>
                {o.description}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (artifact.type === 'workflow-card' && Array.isArray(a.steps)) {
    const steps = a.steps as string[];
    return (
      <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.7 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    );
  }

  if (artifact.type === 'action-suggestion') {
    return (
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{String(a.title || '—')}</div>
        {a.description ? (
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4 }}>
            {String(a.description)}
          </div>
        ) : null}
      </div>
    );
  }

  // Fallback: raw JSON
  return (
    <pre
      style={{
        margin: 0,
        fontSize: 10.5,
        color: 'var(--ink-4)',
        overflow: 'auto',
        maxHeight: 200,
        fontFamily: 'var(--f-mono)',
      }}
    >
      {JSON.stringify(artifact, null, 2)}
    </pre>
  );
}

function humanizeType(t: string): string {
  return t.replace(/-/g, ' ');
}

// =============================================================================
// Strip artifact blocks from message text so the chat column shows only prose
// =============================================================================

function stripArtifacts(content: string): string {
  return content.replace(/:::artifact[\s\S]*?:::/g, '').trim();
}
