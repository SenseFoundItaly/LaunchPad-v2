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
import { useRouter, useSearchParams } from 'next/navigation';
import api from '@/api';
import { useChat } from '@/hooks/useChat';
import { useProject } from '@/hooks/useProject';
import { parseMessageContent } from '@/lib/artifact-parser';
import type { Artifact, ArtifactType } from '@/types/artifacts';
import ArtifactRenderer from '@/components/chat/artifacts/ArtifactRenderer';
import { TopBar, NavRail } from '@/components/design/chrome';
import { CreditsBadge } from '@/components/CreditsBadge';
import {
  Pill,
  StatusBar,
  Icon,
  I,
  IconBtn,
} from '@/components/design/primitives';

// Artifact types that render INLINE in the chat bubble (interactive CTAs)
// rather than in the right-side Canvas. Anything not listed stays in Canvas.
const INLINE_ARTIFACT_TYPES = new Set<ArtifactType>(['option-set', 'action-suggestion', 'task']);

function classifyArtifacts(content: string): { inline: Artifact[]; canvas: Artifact[] } {
  const segments = parseMessageContent(content);
  const all = segments
    .filter((s) => s.type === 'artifact')
    .map((s) => (s as { type: 'artifact'; artifact: Artifact }).artifact);
  return {
    inline: all.filter((a) => INLINE_ARTIFACT_TYPES.has(a.type)),
    canvas: all.filter((a) => !INLINE_ARTIFACT_TYPES.has(a.type)),
  };
}

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
  const router = useRouter();
  const searchParams = useSearchParams();
  // Thread id rides on the existing chat_messages.step column. Default thread
  // ('chat') preserves all rows written before threading existed.
  const thread = searchParams.get('thread');
  const step = thread ? `chat:${thread}` : 'chat';
  const { messages, isStreaming, sendMessage, setMessages } = useChat(projectId, step);
  const [input, setInput] = useState('');
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // Canvas tabs — Latest (this turn's artifacts), Tasks (durable TODO list),
  // Intelligence (durable facts/alerts/score/nodes aggregated over time).
  const [canvasTab, setCanvasTab] = useState<CanvasTab>('latest');
  const scrollRef = useRef<HTMLDivElement>(null);

  const locale = (project as unknown as { locale?: string })?.locale === 'it' ? 'it' : 'en';

  // Load existing chat history for the active thread.
  // Race-guard: a stale response (e.g. user switched threads mid-fetch) is
  // ignored so we never show another thread's messages.
  useEffect(() => {
    let cancelled = false;
    api.get<HistoryResp>(`/api/chat/history?project_id=${projectId}&step=${encodeURIComponent(step)}`)
      .then(({ data }) => {
        if (cancelled) return;
        const restored = data.success && Array.isArray(data.data) && data.data.length > 0
          ? data.data.map((m, i) => ({
            id: `restored_${i}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
          }))
          : [];
        setMessages(restored);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, step, setMessages]);

  // Auto-scroll to newest
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Split parsed artifacts: option-set / action-suggestion render INLINE in
  // the chat bubble; everything else goes to the right Canvas.
  // Inline cards are kept per-message so the user can still interact with old
  // CTAs after the agent has streamed a follow-up.
  const { canvasArtifacts, inlineArtifactsByMsgId } = useMemo(() => {
    const inlineMap = new Map<string, Artifact[]>();
    let canvas: Artifact[] = [];
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.content) continue;
      const split = classifyArtifacts(m.content);
      if (split.inline.length > 0) inlineMap.set(m.id, split.inline);
      // Canvas reflects only the latest assistant message.
      canvas = split.canvas;
    }
    return { canvasArtifacts: canvas, inlineArtifactsByMsgId: inlineMap };
  }, [messages]);

  function handleSend() {
    const v = input.trim();
    if (!v || isStreaming) return;
    sendMessage(v);
    setInput('');
  }

  /**
   * Page-level artifact action handler.
   *
   * Audit finding (2026-04-23): prior to this, `onArtifactAction` was
   * threaded through ChatMessage → ArtifactRenderer but never connected to
   * a real handler at the page level. This is the missing wire.
   *
   * Currently routes two monitor-proposal actions:
   *   - 'monitor:approve' → POST /api/projects/{id}/actions/{actionId}
   *     with transition='approve' (+ optional edited_payload for
   *     Edit-before-approve flows). The configure_monitor executor fires
   *     server-side and creates the monitors row.
   *   - 'monitor:dismiss' → transition='reject' (marks pending_action as
   *     rejected; records a preference fact so the agent learns).
   *
   * Throws on non-2xx so the calling card can flip to its error state.
   * Returns void on success so MonitorProposalCard's resolved-approved /
   * resolved-dismissed transitions fire.
   *
   * Other artifact actions (select-option, trigger-action, etc.) stay
   * routed to sendMessage (legacy pattern) — TODO: migrate those to their
   * own server routes in v2 for symmetry.
   */
  const handleArtifactAction = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<void> => {
      if (
        action === 'monitor:approve' || action === 'monitor:dismiss' ||
        action === 'budget:approve' || action === 'budget:dismiss'
      ) {
        const pendingActionId = String(payload.pending_action_id ?? '');
        if (!pendingActionId) throw new Error(`Missing pending_action_id on ${action}`);
        const isApprove = action === 'monitor:approve' || action === 'budget:approve';
        const transition = isApprove ? 'approve' : 'reject';
        const body: Record<string, unknown> = { transition };
        if (isApprove && payload.overrides) {
          body.edited_payload = payload.overrides;
        }
        if (!isApprove && typeof payload.reason === 'string') {
          body.reason = payload.reason;
        }
        const res = await fetch(
          `/api/projects/${projectId}/actions/${pendingActionId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Action failed with status ${res.status}`);
        }
        // Budget cap changed → CreditsBadge listens for this event to refetch.
        if (action === 'budget:approve' && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
        }
        return;
      }
      if (
        action === 'task:done' ||
        action === 'task:snooze' ||
        action === 'task:dismiss' ||
        action === 'task:expand'
      ) {
        // Tasks address their pending_actions row by client_artifact_id (the
        // agent-chosen artifact.id), not the server-assigned pending_action_id.
        // See src/app/api/projects/[projectId]/tasks/[clientArtifactId]/route.ts.
        const artifactId = String(payload.artifact_id ?? '');
        if (!artifactId) throw new Error('Missing artifact_id on task action');
        const verb =
          action === 'task:done' ? 'done' :
          action === 'task:snooze' ? 'snooze' :
          action === 'task:expand' ? 'expand' : 'dismiss';
        const body: Record<string, unknown> = { action: verb };
        if (verb === 'snooze' && typeof payload.snooze_hours === 'number') {
          body.snooze_hours = payload.snooze_hours;
        }
        if (verb === 'dismiss' && typeof payload.reason === 'string') {
          body.reason = payload.reason;
        }
        const res = await fetch(
          `/api/projects/${projectId}/tasks/${encodeURIComponent(artifactId)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Task action failed with status ${res.status}`);
        }
        // Expand has a richer response — broadcast the new fields to the
        // TaskCard via a CustomEvent so the in-place expansion renders
        // without a follow-up fetch. Other verbs just signal a refetch.
        if (verb === 'expand' && typeof window !== 'undefined') {
          const expanded = await res.json().catch(() => null);
          if (expanded) {
            window.dispatchEvent(new CustomEvent('lp-task-expanded', {
              detail: { artifact_id: artifactId, fields: expanded },
            }));
          }
        }
        // Notify other surfaces (Tasks tab) so they can refetch.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-tasks-changed', { detail: { projectId, artifactId, verb } }));
        }
        return;
      }
      // Fallback for other artifact actions — re-send as chat so the agent
      // can react. Matches legacy OptionSetCard / ActionSuggestionCard usage.
      if (action === 'select-option' && typeof payload.label === 'string') {
        sendMessage(`I choose: ${payload.label}`);
      } else if (action === 'trigger-action' && typeof payload.title === 'string') {
        const desc = typeof payload.description === 'string' ? payload.description : '';
        sendMessage(`${payload.title}${desc ? ': ' + desc : ''}. Give me a detailed step-by-step plan.`);
      }
    },
    [projectId, sendMessage],
  );

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
            <CreditsBadge projectId={projectId} />
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
                  inlineArtifacts={inlineArtifactsByMsgId.get(m.id)}
                  onArtifactAction={handleArtifactAction}
                  onQuickReply={!isStreaming ? sendMessage : undefined}
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
            onNewChat={() => {
              const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : Math.random().toString(36)).slice(0, 8);
              router.replace(`/project/${projectId}/chat?thread=${id}`);
              setInput('');
            }}
            onInsertTemplate={(text) => setInput((prev) => prev ? `${prev}\n${text}` : text)}
            onAttachText={(name, body) =>
              setInput((prev) => {
                const block = `Here is \`${name}\`:\n\n\`\`\`\n${body}\n\`\`\`\n`;
                return prev ? `${prev}\n${block}` : block;
              })
            }
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
          <CanvasHeader
            count={canvasArtifacts.length}
            locale={locale}
            tab={canvasTab}
            onTabChange={setCanvasTab}
          />
          {canvasTab === 'latest' && (
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
                canvasArtifacts.map((a, i) => (
                  <ArtifactCard key={i} artifact={a} onAction={handleArtifactAction} />
                ))
              )}
            </div>
          )}
          {canvasTab === 'tasks' && (
            <TasksTab projectId={projectId} onAction={handleArtifactAction} locale={locale} />
          )}
          {canvasTab === 'intelligence' && (
            <IntelligenceTab projectId={projectId} locale={locale} />
          )}
          {canvasTab === 'activity' && (
            <ActivityTab projectId={projectId} locale={locale} onJumpTasks={() => setCanvasTab('tasks')} />
          )}
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
  inlineArtifacts,
  onArtifactAction,
  onQuickReply,
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
  /** Conversational artifacts (option-set, action-suggestion) that render
   *  inside the assistant bubble instead of the right-side Canvas. */
  inlineArtifacts?: Artifact[];
  onArtifactAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  /** Fallback for when the model omitted an option-set — sends a pre-written reply. */
  onQuickReply?: (text: string) => void;
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
        className="lp-msg-row lp-md"
        style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}
      >
        <MdProse text={String(children ?? '')} />
      </div>
      {inlineArtifacts && inlineArtifacts.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {inlineArtifacts.map((a, i) => (
            <InlineArtifact key={i} artifact={a} onAction={onArtifactAction} />
          ))}
        </div>
      )}
      {/* Fallback quick-reply chips when the model omitted an option-set */}
      {!streaming && who === 'ai' && (!inlineArtifacts || inlineArtifacts.length === 0) && (
        <QuickReplies rawContent={rawContent} onReply={onQuickReply} />
      )}
      {!streaming && <MsgActions content={rawContent} align="left" />}
    </div>
  );
}

/**
 * Fallback quick-reply chips shown below any complete assistant message that
 * has no model-generated option-set. Provides 3 always-relevant suggestions
 * extracted from the message context. Disappears once the user interacts.
 */

/**
 * Lightweight markdown-to-JSX renderer. Handles the patterns the agent emits:
 * **bold**, *italic*, headings, bullet/ordered lists, `code`, --- hr, paragraphs.
 * No external dependency needed.
 */
function MdProse({ text }: { text: string }) {
  const inline = (s: string, key: number | string) => {
    const parts: React.ReactNode[] = [];
    let i = 0;
    const push = (node: React.ReactNode) => parts.push(node);
    while (i < s.length) {
      if (s.startsWith('**', i)) {
        const end = s.indexOf('**', i + 2);
        if (end !== -1) { push(<strong key={`b${i}`}>{s.slice(i + 2, end)}</strong>); i = end + 2; continue; }
      }
      if (s.startsWith('*', i) && !s.startsWith('**', i)) {
        const end = s.indexOf('*', i + 1);
        if (end !== -1) { push(<em key={`e${i}`}>{s.slice(i + 1, end)}</em>); i = end + 1; continue; }
      }
      if (s.startsWith('`', i)) {
        const end = s.indexOf('`', i + 1);
        if (end !== -1) { push(<code key={`c${i}`}>{s.slice(i + 1, end)}</code>); i = end + 1; continue; }
      }
      // Find next marker AFTER current position to avoid infinite loop
      // when the current char is an unmatched marker (no closing pair).
      const searchFrom = i + 1;
      const next = Math.min(
        s.indexOf('**', searchFrom) === -1 ? Infinity : s.indexOf('**', searchFrom),
        s.indexOf('*', searchFrom) === -1 ? Infinity : s.indexOf('*', searchFrom),
        s.indexOf('`', searchFrom) === -1 ? Infinity : s.indexOf('`', searchFrom),
      );
      const end2 = isFinite(next) ? next : s.length;
      push(s.slice(i, end2));
      i = end2;
    }
    return parts.length === 1 ? parts[0] : <span key={key}>{parts}</span>;
  };

  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i2 = 0;
  while (i2 < lines.length) {
    const line = lines[i2];
    // HR
    if (/^---+$/.test(line.trim())) { nodes.push(<hr key={i2} />); i2++; continue; }
    // Headings
    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      const level = hm[1].length;
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3';
      nodes.push(<Tag key={i2}>{inline(hm[2], i2)}</Tag>);
      i2++; continue;
    }
    // Unordered list — collect consecutive items
    if (/^[-*]\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i2 < lines.length && /^[-*]\s/.test(lines[i2])) {
        items.push(<li key={i2}>{inline(lines[i2].replace(/^[-*]\s/, ''), i2)}</li>);
        i2++;
      }
      nodes.push(<ul key={`ul${i2}`}>{items}</ul>);
      continue;
    }
    // Ordered list — collect consecutive items
    if (/^\d+\.\s/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i2 < lines.length && /^\d+\.\s/.test(lines[i2])) {
        items.push(<li key={i2}>{inline(lines[i2].replace(/^\d+\.\s/, ''), i2)}</li>);
        i2++;
      }
      nodes.push(<ol key={`ol${i2}`}>{items}</ol>);
      continue;
    }
    // Blank line = paragraph break (skip)
    if (line.trim() === '') { i2++; continue; }
    // Paragraph — collect until blank line or special block
    const pLines: string[] = [];
    while (i2 < lines.length && lines[i2].trim() !== '' && !/^(#{1,3}\s|[-*]\s|\d+\.\s|---+$)/.test(lines[i2])) {
      pLines.push(lines[i2]);
      i2++;
    }
    if (pLines.length) {
      nodes.push(<p key={`p${i2}`}>{inline(pLines.join(' '), `p${i2}`)}</p>);
    }
  }
  return <>{nodes}</>;
}

function QuickReplies({
  rawContent,
  onReply,
}: {
  rawContent: string;
  onReply?: (text: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !onReply) return null;

  const prose = rawContent.replace(/:::artifact[\s\S]*?:::/g, '').trim();

  // Extract the last question sentence to generate context-aware chips.
  const lastQuestion = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().endsWith('?')).pop()?.trim() ?? '';
  const hasQuestion = lastQuestion.length > 0;

  const chips = hasQuestion
    ? [
      'Give me 3 concrete examples to choose from',
      'Help me think through this step by step',
      'Move on — I will figure this out later',
    ]
    : [
      'What should I prioritize first?',
      'Where are the biggest risks?',
      'Give me a concrete next step',
    ];

  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {chips.map((chip) => (
        <button
          key={chip}
          type="button"
          onClick={() => {
            setDismissed(true);
            onReply(chip);
          }}
          style={{
            padding: '5px 10px',
            fontSize: 12,
            color: 'var(--ink-3)',
            background: 'var(--surface)',
            border: '1px solid var(--line-2)',
            borderRadius: 'var(--r-m)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            transition: 'border-color .1s, color .1s',
          }}
          className="lp-rail-item"
        >
          {chip}
        </button>
      ))}
    </div>
  );
}

/**
 * Inline artifact renderer for option-set / action-suggestion.
 *
 * These render INSIDE the assistant bubble (not in Canvas) so the user can
 * click a CTA without crossing the pane boundary. Click handlers route
 * through the page-level handleArtifactAction, which currently posts a
 * follow-up user turn back through the chat pipeline.
 */
function InlineArtifact({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const a = artifact as unknown as Record<string, unknown>;

  if (artifact.type === 'option-set' && Array.isArray(a.options)) {
    const options = a.options as Array<{ id?: string; label?: string; description?: string }>;
    const prompt = typeof a.prompt === 'string' ? a.prompt : '';
    return (
      <div
        style={{
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-m)',
          background: 'var(--surface)',
          padding: 10,
        }}
      >
        {prompt && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginBottom: 8 }}>
            {prompt}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.map((o, i) => (
            <button
              key={o.id || i}
              type="button"
              onClick={() =>
                onAction?.('select-option', {
                  optionId: o.id ?? String(i),
                  label: o.label ?? `Option ${i + 1}`,
                })
              }
              className="lp-inline-option"
              style={{
                textAlign: 'left',
                padding: '9px 11px',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r-m)',
                background: 'var(--paper)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                color: 'var(--ink-2)',
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                {o.label || `Option ${i + 1}`}
              </div>
              {o.description && (
                <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2, lineHeight: 1.4 }}>
                  {o.description}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (artifact.type === 'action-suggestion') {
    const title = String(a.title || '—');
    const description = typeof a.description === 'string' ? a.description : '';
    const cta = typeof a.action_label === 'string' ? a.action_label : 'Run';
    return (
      <div
        style={{
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-m)',
          background: 'var(--surface)',
          padding: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{title}</div>
          {description && (
            <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2, lineHeight: 1.4 }}>
              {description}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onAction?.('trigger-action', { title, description })}
          style={{
            flexShrink: 0,
            padding: '6px 10px',
            borderRadius: 'var(--r-m)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 11.5,
            fontFamily: 'inherit',
            fontWeight: 500,
          }}
        >
          {cta}
        </button>
      </div>
    );
  }

  if (artifact.type === 'task') {
    return <TaskCard artifact={artifact} onAction={onAction} />;
  }

  return null;
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────
//
// Inline founder-task card: priority pill, title (.lp-serif), optional
// description (.lp-md), three actions — Mark done / Snooze / Dismiss.
// Resolves to /api/projects/[projectId]/tasks/[clientArtifactId] via
// handleArtifactAction.
const TASK_PRIORITY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: 'var(--clay)',     fg: '#FFF',          label: 'Critical' },
  high:     { bg: 'var(--accent)',   fg: 'var(--ink)',    label: 'High' },
  medium:   { bg: 'var(--sky)',      fg: '#FFF',          label: 'Medium' },
  low:      { bg: 'var(--paper-3)',  fg: 'var(--ink-3)',  label: 'Low' },
};

/**
 * In-memory shape returned by /api/projects/{id}/tasks/{artifactId} POST
 * with action='expand'. Mirrored on the artifact (TaskArtifact) so the card
 * can render expanded breakdowns from either the live response OR a
 * previously-expanded task that was already persisted.
 */
interface TaskExpansion {
  details?: string;
  subtasks?: string[];
  references?: Array<{ title?: string; url?: string; quote?: string; type?: string }>;
  estimated_effort?: string;
  expanded_at?: string;
}

function TaskCard({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const a = artifact as unknown as Record<string, unknown>;
  const title = typeof a.title === 'string' ? a.title : '—';
  const description = typeof a.description === 'string' ? a.description : '';
  const due = typeof a.due === 'string' ? a.due : '';
  const priority = (typeof a.priority === 'string' ? a.priority : 'medium') as keyof typeof TASK_PRIORITY_STYLES;
  const style = TASK_PRIORITY_STYLES[priority] || TASK_PRIORITY_STYLES.medium;
  const artifactId = typeof a.id === 'string' ? a.id : '';

  // Existing-on-artifact expansion (a previously-expanded task that was
  // re-rendered from the persisted artifact JSON). Treated as the seed for
  // the local `expansion` state.
  const seedExpansion: TaskExpansion = {
    details: typeof a.details === 'string' ? a.details : undefined,
    subtasks: Array.isArray(a.subtasks) ? (a.subtasks as string[]) : undefined,
    references: Array.isArray(a.references) ? (a.references as TaskExpansion['references']) : undefined,
    estimated_effort: typeof a.estimated_effort === 'string' ? a.estimated_effort : undefined,
    expanded_at: typeof a.expanded_at === 'string' ? a.expanded_at : undefined,
  };

  const [state, setState] = useState<'idle' | 'pending' | 'expanding' | 'done' | 'snoozed' | 'dismissed' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expansion, setExpansion] = useState<TaskExpansion>(seedExpansion);
  const [checkedSubtasks, setCheckedSubtasks] = useState<Set<number>>(new Set());

  // Listen for the page-level handler's success event to capture the
  // expansion fields without needing onAction to return data. The handler
  // dispatches `lp-task-expanded` synchronously after the fetch resolves.
  useEffect(() => {
    if (!artifactId) return;
    const handler = (e: Event) => {
      const evt = e as CustomEvent<{ artifact_id?: string; fields?: TaskExpansion }>;
      if (evt.detail?.artifact_id !== artifactId || !evt.detail.fields) return;
      setExpansion((prev) => ({ ...prev, ...evt.detail!.fields }));
      setState('idle');
    };
    window.addEventListener('lp-task-expanded', handler as EventListener);
    return () => window.removeEventListener('lp-task-expanded', handler as EventListener);
  }, [artifactId]);

  async function trigger(verb: 'done' | 'snooze' | 'dismiss' | 'expand') {
    if ((state === 'pending' || state === 'expanding') || !onAction) return;
    setState(verb === 'expand' ? 'expanding' : 'pending');
    setErrorMsg(null);
    try {
      await onAction(`task:${verb}`, { artifact_id: artifactId });
      if (verb === 'done') setState('done');
      else if (verb === 'snooze') setState('snoozed');
      else if (verb === 'dismiss') setState('dismissed');
      // For 'expand', state is reset to 'idle' by the lp-task-expanded
      // listener above. If the listener never fires (handler succeeded but
      // didn't dispatch), fall back to idle here so the UI doesn't get stuck.
      else setState('idle');
    } catch (err) {
      setState('error');
      setErrorMsg((err as Error).message);
    }
  }

  if (state === 'done' || state === 'dismissed') {
    const verb = state === 'done' ? 'Marked done' : 'Dismissed';
    return (
      <div
        style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-m)',
          background: 'var(--surface-sunk)',
          padding: 10,
          fontSize: 12,
          color: 'var(--ink-4)',
          fontStyle: 'italic',
        }}
      >
        {verb}: {title}
      </div>
    );
  }

  const hasExpansion =
    !!expansion.details ||
    (expansion.subtasks && expansion.subtasks.length > 0) ||
    !!expansion.estimated_effort;
  const canExpand = !hasExpansion && state !== 'expanding';

  return (
    <div
      style={{
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-m)',
        background: 'var(--surface)',
        padding: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        <span
          className="lp-chip"
          style={{
            background: style.bg,
            color: style.fg,
            border: 'none',
            flexShrink: 0,
          }}
        >
          {style.label}
        </span>
        <div className="lp-serif" style={{ fontSize: 13.5, lineHeight: 1.35, color: 'var(--ink)', flex: 1 }}>
          {title}
        </div>
        {expansion.estimated_effort && (
          <span
            className="lp-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-4)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-s)',
              padding: '1px 6px',
              flexShrink: 0,
              background: 'var(--paper-2)',
            }}
            title="Estimated effort"
          >
            ~ {expansion.estimated_effort}
          </span>
        )}
      </div>
      {description && (
        <div className="lp-md" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 8 }}>
          {description}
        </div>
      )}
      {due && (
        <div style={{ fontSize: 11, color: 'var(--ink-5)', marginBottom: 8, fontFamily: 'var(--f-mono)' }}>
          due · {due}
        </div>
      )}
      {state === 'snoozed' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginBottom: 6 }}>
          Snoozed for 24h.
        </div>
      )}
      {state === 'expanding' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginBottom: 6 }}>
          Expanding plan…
        </div>
      )}
      {state === 'error' && errorMsg && (
        <div style={{ fontSize: 11, color: 'var(--clay)', marginBottom: 6 }}>
          {errorMsg}
        </div>
      )}

      {/* Expanded section — rendered when expansion has any meaningful field */}
      {hasExpansion && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 8,
            padding: 8,
            background: 'var(--paper-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-s)',
          }}
        >
          {expansion.details && (
            <div className="lp-md" style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.4 }}>
              {expansion.details}
            </div>
          )}
          {expansion.subtasks && expansion.subtasks.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {expansion.subtasks.map((st, i) => {
                const checked = checkedSubtasks.has(i);
                return (
                  <li
                    key={i}
                    onClick={() => {
                      // UI-only check state for now (v2 may persist).
                      setCheckedSubtasks((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      fontSize: 11.5,
                      color: checked ? 'var(--ink-4)' : 'var(--ink-2)',
                      textDecoration: checked ? 'line-through' : 'none',
                      cursor: 'pointer',
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        marginTop: 2,
                        border: '1px solid var(--line-2)',
                        borderRadius: 3,
                        background: checked ? 'var(--ink)' : 'transparent',
                        color: checked ? 'var(--paper)' : 'transparent',
                        fontSize: 10,
                        lineHeight: 1,
                      }}
                    >
                      {checked ? '✓' : ''}
                    </span>
                    <span>{st}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {expansion.references && expansion.references.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {expansion.references.map((r, i) => {
                const label = r?.title ?? r?.url ?? `ref ${i + 1}`;
                const isLink = typeof r?.url === 'string' && r.url.length > 0;
                const chipStyle: React.CSSProperties = {
                  fontSize: 10,
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r-s)',
                  padding: '1px 6px',
                  background: 'var(--surface)',
                  textDecoration: 'none',
                };
                return isLink ? (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" style={chipStyle}>
                    {label}
                  </a>
                ) : (
                  <span key={i} style={chipStyle}>{label}</span>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          disabled={state === 'pending' || state === 'expanding'}
          onClick={() => trigger('done')}
          style={{
            flex: 1,
            padding: '6px 10px',
            borderRadius: 'var(--r-m)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            border: 'none',
            cursor: state === 'pending' || state === 'expanding' ? 'wait' : 'pointer',
            fontSize: 11.5,
            fontWeight: 500,
            fontFamily: 'inherit',
            opacity: state === 'pending' || state === 'expanding' ? 0.6 : 1,
          }}
        >
          Mark done
        </button>
        {canExpand && (
          <button
            type="button"
            // canExpand already excludes 'expanding'; only 'pending' is left as
            // a busy signal here. Plain boolean to avoid a TS narrowing issue.
            disabled={(state as string) === 'pending'}
            onClick={() => trigger('expand')}
            title="Ask the agent to break this down into subtasks"
            style={{
              padding: '6px 10px',
              borderRadius: 'var(--r-m)',
              background: 'var(--paper-2)',
              color: 'var(--ink-2)',
              border: '1px solid var(--line-2)',
              cursor: (state as string) === 'pending' ? 'wait' : 'pointer',
              fontSize: 11.5,
              fontFamily: 'inherit',
            }}
          >
            Expand
          </button>
        )}
        <button
          type="button"
          disabled={state === 'pending' || state === 'expanding'}
          onClick={() => trigger('snooze')}
          style={{
            padding: '6px 10px',
            borderRadius: 'var(--r-m)',
            background: 'var(--paper-2)',
            color: 'var(--ink-2)',
            border: '1px solid var(--line-2)',
            cursor: state === 'pending' || state === 'expanding' ? 'wait' : 'pointer',
            fontSize: 11.5,
            fontFamily: 'inherit',
          }}
        >
          Snooze
        </button>
        <button
          type="button"
          disabled={state === 'pending' || state === 'expanding'}
          onClick={() => trigger('dismiss')}
          style={{
            padding: '6px 10px',
            borderRadius: 'var(--r-m)',
            background: 'transparent',
            color: 'var(--ink-4)',
            border: '1px solid var(--line-2)',
            cursor: state === 'pending' || state === 'expanding' ? 'wait' : 'pointer',
            fontSize: 11.5,
            fontFamily: 'inherit',
          }}
        >
          Dismiss
        </button>
      </div>
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
  onNewChat,
  onInsertTemplate,
  onAttachText,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  locale: 'en' | 'it';
  onNewChat?: () => void;
  onInsertTemplate?: (text: string) => void;
  onAttachText?: (name: string, body: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const templates = locale === 'it'
    ? [
      { label: 'Riassumi le mie metriche', text: 'Riassumi le metriche chiave del progetto e identifica i 3 segnali più importanti questa settimana.' },
      { label: 'Analizza un competitor', text: 'Aiutami ad analizzare un competitor: chi è, cosa offre, come si differenzia da noi.' },
      { label: 'Pianifica esperimenti ICP', text: 'Proponi 3 esperimenti rapidi (≤7 giorni) per validare il mio ICP.' },
    ]
    : [
      { label: 'Summarize my metrics', text: 'Summarize my project key metrics and surface the 3 most important signals from this week.' },
      { label: 'Analyze a competitor', text: 'Help me analyze a competitor: who they are, what they sell, how they differ from us.' },
      { label: 'Plan ICP experiments', text: 'Propose 3 quick experiments (≤7 days) to validate my ICP.' },
    ];

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 200 * 1024) {
      alert(locale === 'it' ? 'File troppo grande (max 200KB).' : 'File too large (max 200KB).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      onAttachText?.(f.name, text);
      setMenuOpen(false);
    };
    reader.readAsText(f);
  }

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <IconBtn
              d={I.plus}
              size={24}
              title={locale === 'it' ? 'azioni' : 'actions'}
              onClick={() => setMenuOpen((v) => !v)}
            />
            {menuOpen && (
              <ComposerMenu
                locale={locale}
                templates={templates}
                onClose={() => setMenuOpen(false)}
                onNewChat={onNewChat}
                onInsertTemplate={onInsertTemplate}
                onAttach={() => fileInputRef.current?.click()}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.csv,.json,.log,.yml,.yaml,.tsv"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>
          <IconBtn
            d={I.sparkles}
            size={24}
            title={locale === 'it' ? 'inserisci template' : 'insert template'}
            onClick={() => onInsertTemplate?.(templates[0].text)}
          />
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

/**
 * Popover menu anchored to the composer's "+" button.
 *
 * Three sections:
 *   - New chat — starts a fresh thread (handled by parent via URL nav).
 *   - Templates — quick-insert prompts into the textarea.
 *   - Attach    — opens a file picker (text-like files only, ≤200KB).
 *
 * Closes on outside click and Escape.
 */
function ComposerMenu({
  locale,
  templates,
  onClose,
  onNewChat,
  onInsertTemplate,
  onAttach,
}: {
  locale: 'en' | 'it';
  templates: { label: string; text: string }[];
  onClose: () => void;
  onNewChat?: () => void;
  onInsertTemplate?: (text: string) => void;
  onAttach: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '7px 10px',
    fontSize: 12.5,
    color: 'var(--ink-2)',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 6px)',
        left: 0,
        zIndex: 50,
        width: 240,
        padding: 6,
        background: 'var(--paper)',
        border: '1px solid var(--line-2)',
        borderRadius: 'var(--r-m)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.08)',
      }}
    >
      {onNewChat && (
        <>
          <button
            type="button"
            style={itemStyle}
            onClick={() => {
              onNewChat();
              onClose();
            }}
          >
            {locale === 'it' ? '+ Nuova chat' : '+ New chat'}
          </button>
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        </>
      )}
      <div
        style={{
          padding: '4px 10px',
          fontSize: 10,
          color: 'var(--ink-5)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          fontFamily: 'var(--f-mono)',
        }}
      >
        {locale === 'it' ? 'Template' : 'Templates'}
      </div>
      {templates.map((t) => (
        <button
          key={t.label}
          type="button"
          style={itemStyle}
          onClick={() => {
            onInsertTemplate?.(t.text);
            onClose();
          }}
        >
          {t.label}
        </button>
      ))}
      <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
      <button
        type="button"
        style={itemStyle}
        onClick={() => {
          onAttach();
          onClose();
        }}
      >
        {locale === 'it' ? 'Allega file…' : 'Attach file…'}
        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-5)' }}>
          .txt .md .csv .json
        </span>
      </button>
    </div>
  );
}

// =============================================================================
// Canvas
// =============================================================================

type CanvasTab = 'latest' | 'tasks' | 'intelligence' | 'activity';

// ─── TasksTab ─────────────────────────────────────────────────────────────────
//
// Durable list of open founder tasks (action_type='task'). Refetches when:
//   - mounted
//   - any TaskCard mutates (lp-tasks-changed window event)
//   - the chat finishes a turn (keyed off `messages.length` not feasible from
//     here — we listen for the same window event the inline TaskCard fires)
interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  due: string | null;
  client_artifact_id: string | null;
  status: string;
  created_at: string;
  // Phase G — expansion fields. Optional / null until the founder clicks
  // Expand on a TaskCard or TaskListRow and the LLM returns a plan.
  details?: string | null;
  subtasks?: string[] | null;
  references?: Array<{ title?: string; url?: string; quote?: string }> | null;
  estimated_effort?: string | null;
  expanded_at?: string | null;
}

const TASK_PRIORITY_ORDER: TaskListItem['priority'][] = ['critical', 'high', 'medium', 'low'];

function TasksTab({
  projectId,
  onAction,
  locale,
}: {
  projectId: string;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
  locale: 'en' | 'it';
}) {
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 1 — cross-lane counts so the founder sees "you also have 3 drafts
  // waiting" without needing to leave the chat to find them. Cheap parallel
  // fetches; the Inbox endpoints are <50ms each in practice.
  const [approvalCount, setApprovalCount] = useState(0);
  const [notificationCount, setNotificationCount] = useState(0);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasksRes, approvalsRes, notificationsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/tasks`),
        fetch(`/api/projects/${projectId}/approvals`),
        fetch(`/api/projects/${projectId}/notifications`),
      ]);
      const tasksBody = await tasksRes.json();
      if (!tasksRes.ok || tasksBody?.success === false) {
        throw new Error(tasksBody?.error || `HTTP ${tasksRes.status}`);
      }
      const tasksData = tasksBody?.data ?? tasksBody;
      setTasks(Array.isArray(tasksData?.tasks) ? tasksData.tasks : []);

      // Approvals + notifications are non-blocking — failure shouldn't hide
      // the tasks list. Best-effort parse; default to 0 on any parse error.
      try {
        const approvalsBody = await approvalsRes.json();
        const data = approvalsBody?.data ?? approvalsBody;
        setApprovalCount(typeof data?.counts?.total === 'number' ? data.counts.total : 0);
      } catch { setApprovalCount(0); }
      try {
        const notificationsBody = await notificationsRes.json();
        const data = notificationsBody?.data ?? notificationsBody;
        setNotificationCount(typeof data?.counts?.total === 'number' ? data.counts.total : 0);
      } catch { setNotificationCount(0); }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refetch();
    const handler = () => refetch();
    window.addEventListener('lp-tasks-changed', handler);
    return () => window.removeEventListener('lp-tasks-changed', handler);
  }, [refetch]);

  const grouped = useMemo(() => {
    const map: Record<TaskListItem['priority'], TaskListItem[]> = {
      critical: [], high: [], medium: [], low: [],
    };
    for (const t of tasks) {
      const k = (TASK_PRIORITY_ORDER as string[]).includes(t.priority) ? t.priority : 'medium';
      map[k].push(t);
    }
    return map;
  }, [tasks]);

  const otherLanesTotal = approvalCount + notificationCount;

  return (
    <div
      className="lp-scroll"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      {/* Phase 1 — cross-lane awareness banner. Shown only when other lanes
          have open rows so the Tasks tab stays clean otherwise. Click jumps
          to the full Inbox where the founder can switch lanes. */}
      {otherLanesTotal > 0 && (
        <a
          href={`/project/${projectId}/actions`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            background: 'var(--paper-2)',
            border: '1px solid var(--line-2)',
            borderRadius: 6,
            fontSize: 11.5,
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontFamily: 'var(--f-sans)',
          }}
        >
          <span>
            {locale === 'it' ? 'Hai anche ' : 'You also have '}
            {approvalCount > 0 && (
              <strong style={{ color: 'var(--ink-2)' }}>
                {approvalCount} {locale === 'it' ? 'approvazion' + (approvalCount === 1 ? 'e' : 'i') : 'approval' + (approvalCount === 1 ? '' : 's')}
              </strong>
            )}
            {approvalCount > 0 && notificationCount > 0 && ' · '}
            {notificationCount > 0 && (
              <strong style={{ color: 'var(--ink-2)' }}>
                {notificationCount} {locale === 'it' ? 'notific' + (notificationCount === 1 ? 'a' : 'he') : 'notification' + (notificationCount === 1 ? '' : 's')}
              </strong>
            )}
            {locale === 'it' ? ' nell’Inbox.' : ' in the Inbox.'}
          </span>
          <span style={{ color: 'var(--accent)', fontSize: 11 }}>
            {locale === 'it' ? 'Apri Inbox →' : 'Open Inbox →'}
          </span>
        </a>
      )}
      {loading && tasks.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--ink-5)', textAlign: 'center', padding: 40 }}>
          {locale === 'it' ? 'Caricamento task…' : 'Loading tasks…'}
        </div>
      )}
      {error && (
        <div style={{ fontSize: 12, color: 'var(--clay)', textAlign: 'center', padding: 12 }}>
          {error}
        </div>
      )}
      {!loading && !error && tasks.length === 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 60,
            color: 'var(--ink-4)',
            fontSize: 13,
            textAlign: 'center',
          }}
        >
          <h3 className="lp-serif" style={{ fontSize: 18, fontWeight: 400, margin: 0, color: 'var(--ink-3)' }}>
            {locale === 'it' ? 'Nessun task aperto.' : 'No open tasks.'}
          </h3>
          <p style={{ margin: '10px 0 0', maxWidth: 360, lineHeight: 1.5 }}>
            {locale === 'it'
              ? 'Chiedi al co-pilot di aggiungere un task ("aggiungi un task: ...") e apparirà qui.'
              : 'Ask the co-pilot to add a task ("add a task: …") and it will appear here.'}
          </p>
        </div>
      )}
      {TASK_PRIORITY_ORDER.map((priority) => {
        const list = grouped[priority];
        if (list.length === 0) return null;
        const style = TASK_PRIORITY_STYLES[priority];
        return (
          <div key={priority}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span
                className="lp-chip"
                style={{ background: style.bg, color: style.fg, border: 'none' }}
              >
                {style.label}
              </span>
              <span style={{ fontSize: 11, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                {list.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((t) => (
                <TaskListRow key={t.id} task={t} onAction={onAction} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskListRow({
  task,
  onAction,
}: {
  task: TaskListItem;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<false | 'pending' | 'expanding'>(false);
  // Local mirror of the expansion fields so a freshly-clicked Expand surfaces
  // immediately without waiting for the next refetch. The persisted fields
  // from `task` are the seed; the lp-task-expanded event delivers updates.
  const [localExpansion, setLocalExpansion] = useState<TaskExpansion>(() => ({
    details: task.details ?? undefined,
    subtasks: task.subtasks ?? undefined,
    references: task.references ?? undefined,
    estimated_effort: task.estimated_effort ?? undefined,
    expanded_at: task.expanded_at ?? undefined,
  }));
  const [checkedSubtasks, setCheckedSubtasks] = useState<Set<number>>(new Set());

  // Listen for the page handler's lp-task-expanded broadcast (same channel
  // the inline TaskCard uses) so the Tasks tab updates the row in place.
  useEffect(() => {
    if (!task.client_artifact_id) return;
    const handler = (e: Event) => {
      const evt = e as CustomEvent<{ artifact_id?: string; fields?: TaskExpansion }>;
      if (evt.detail?.artifact_id !== task.client_artifact_id || !evt.detail.fields) return;
      setLocalExpansion((prev) => ({ ...prev, ...evt.detail!.fields }));
      setBusy(false);
    };
    window.addEventListener('lp-task-expanded', handler as EventListener);
    return () => window.removeEventListener('lp-task-expanded', handler as EventListener);
  }, [task.client_artifact_id]);

  async function trigger(verb: 'done' | 'snooze' | 'dismiss' | 'expand') {
    if (busy || !task.client_artifact_id) return;
    setBusy(verb === 'expand' ? 'expanding' : 'pending');
    try {
      await onAction(`task:${verb}`, { artifact_id: task.client_artifact_id });
      // 'expand' busy state is cleared by the lp-task-expanded listener.
      if (verb !== 'expand') setBusy(false);
    } catch {
      setBusy(false);
    }
  }

  const hasExpansion =
    !!localExpansion.details ||
    (localExpansion.subtasks && localExpansion.subtasks.length > 0) ||
    !!localExpansion.estimated_effort;
  const canExpand = !hasExpansion && busy !== 'expanding';

  return (
    <div className="lp-card" style={{ padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
        <div className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)', flex: 1 }}>
          {task.title}
        </div>
        {localExpansion.estimated_effort && (
          <span
            className="lp-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-4)',
              border: '1px solid var(--line-2)',
              borderRadius: 'var(--r-s)',
              padding: '1px 6px',
              flexShrink: 0,
              background: 'var(--paper-2)',
            }}
            title="Estimated effort"
          >
            ~ {localExpansion.estimated_effort}
          </span>
        )}
      </div>
      {task.description && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.45, marginBottom: 6 }}>
          {task.description}
        </div>
      )}
      {task.due && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)', marginBottom: 8 }}>
          due · {task.due}
        </div>
      )}
      {busy === 'expanding' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginBottom: 6 }}>
          Expanding plan…
        </div>
      )}

      {hasExpansion && (
        <div
          style={{
            marginTop: 4,
            marginBottom: 8,
            padding: 8,
            background: 'var(--paper-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-s)',
          }}
        >
          {localExpansion.details && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-2)', marginBottom: 8, lineHeight: 1.4 }}>
              {localExpansion.details}
            </div>
          )}
          {localExpansion.subtasks && localExpansion.subtasks.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {localExpansion.subtasks.map((st, i) => {
                const checked = checkedSubtasks.has(i);
                return (
                  <li
                    key={i}
                    onClick={() => {
                      setCheckedSubtasks((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i); else next.add(i);
                        return next;
                      });
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                      fontSize: 11.5,
                      color: checked ? 'var(--ink-4)' : 'var(--ink-2)',
                      textDecoration: checked ? 'line-through' : 'none',
                      cursor: 'pointer',
                      lineHeight: 1.4,
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 14,
                        height: 14,
                        flexShrink: 0,
                        marginTop: 2,
                        border: '1px solid var(--line-2)',
                        borderRadius: 3,
                        background: checked ? 'var(--ink)' : 'transparent',
                        color: checked ? 'var(--paper)' : 'transparent',
                        fontSize: 10,
                        lineHeight: 1,
                      }}
                    >
                      {checked ? '✓' : ''}
                    </span>
                    <span>{st}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {localExpansion.references && localExpansion.references.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {localExpansion.references.map((r, i) => {
                const label = r?.title ?? r?.url ?? `ref ${i + 1}`;
                const isLink = typeof r?.url === 'string' && r.url.length > 0;
                const chipStyle: React.CSSProperties = {
                  fontSize: 10,
                  color: 'var(--ink-3)',
                  border: '1px solid var(--line-2)',
                  borderRadius: 'var(--r-s)',
                  padding: '1px 6px',
                  background: 'var(--surface)',
                  textDecoration: 'none',
                };
                return isLink ? (
                  <a key={i} href={r.url} target="_blank" rel="noreferrer" style={chipStyle}>
                    {label}
                  </a>
                ) : (
                  <span key={i} style={chipStyle}>{label}</span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {task.client_artifact_id && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => trigger('done')}
            style={{
              flex: 1,
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
              opacity: busy ? 0.6 : 1,
            }}
          >
            Mark done
          </button>
          {canExpand && (
            <button
              type="button"
              disabled={busy !== false}
              onClick={() => trigger('expand')}
              title="Ask the agent to break this down into subtasks"
              style={{
                padding: '5px 8px',
                borderRadius: 'var(--r-m)',
                background: 'var(--paper-2)',
                color: 'var(--ink-3)',
                border: '1px solid var(--line-2)',
                cursor: busy ? 'wait' : 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              Expand
            </button>
          )}
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => trigger('snooze')}
            style={{
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: 'var(--paper-2)',
              color: 'var(--ink-3)',
              border: '1px solid var(--line-2)',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            Snooze
          </button>
          <button
            type="button"
            disabled={busy !== false}
            onClick={() => trigger('dismiss')}
            style={{
              padding: '5px 8px',
              borderRadius: 'var(--r-m)',
              background: 'transparent',
              color: 'var(--ink-4)',
              border: '1px solid var(--line-2)',
              cursor: busy ? 'wait' : 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

// ─── IntelligenceTab ──────────────────────────────────────────────────────────
interface IntelFact {
  id: string;
  fact: string;
  kind: string;
  confidence: number;
  created_at: string;
}
interface IntelAlert {
  id: string;
  headline: string;
  body: string | null;
  source: string | null;
  source_url: string | null;
  relevance_score: number;
  alert_type: string;
  created_at: string;
}
interface IntelNode {
  id: string;
  name: string;
  node_type: string;
  summary: string | null;
  created_at: string;
}
interface IntelScore {
  overall_score: number | null;
  benchmark: string | null;
  scored_at: string | null;
}
interface IntelStage {
  id: string;
  name: string;
  order: number;
  color: string;
  completion_ratio: number;
  overall_score: number;
  verdict: 'strong_go' | 'go' | 'caution' | 'not_ready';
  skills_total: number;
  skills_completed: number;
  last_signal: { type: string; label: string; at: string } | null;
}
interface IntelData {
  facts: IntelFact[];
  alerts: IntelAlert[];
  nodes: IntelNode[];
  score: IntelScore | null;
  stages?: IntelStage[];
}

const VERDICT_COLOR: Record<IntelStage['verdict'], string> = {
  strong_go: 'var(--moss)',
  go: 'var(--moss)',
  caution: 'var(--accent)',
  not_ready: 'var(--clay)',
};
const VERDICT_LABEL: Record<IntelStage['verdict'], { en: string; it: string }> = {
  strong_go: { en: 'STRONG GO',  it: 'AVANTI FORTE' },
  go:        { en: 'GO',         it: 'AVANTI' },
  caution:   { en: 'CAUTION',    it: 'CAUTELA' },
  not_ready: { en: 'NOT READY',  it: 'NON PRONTO' },
};

function relativeTime(iso: string, locale: 'en' | 'it'): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(1, Math.floor((now - then) / 1000));
  if (sec < 60) return locale === 'it' ? `${sec}s fa` : `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return locale === 'it' ? `${min}m fa` : `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return locale === 'it' ? `${hr}h fa` : `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return locale === 'it' ? `${day}g fa` : `${day}d ago`;
  return new Date(iso).toLocaleDateString(locale === 'it' ? 'it' : 'en');
}

function IntelligenceTab({ projectId, locale }: { projectId: string; locale: 'en' | 'it' }) {
  const [data, setData] = useState<IntelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  const [showRecent, setShowRecent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/projects/${projectId}/intelligence`);
        const body = await res.json();
        if (!res.ok || body?.success === false) {
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const inner = body?.data ?? body;
        if (!cancelled) setData(inner);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  if (loading) {
    return (
      <div style={{ flex: 1, padding: 40, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it' ? 'Caricamento intelligence…' : 'Loading intelligence…'}
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ flex: 1, padding: 24, fontSize: 12, color: 'var(--clay)', textAlign: 'center' }}>
        {error}
      </div>
    );
  }
  if (!data) return null;

  const stages = data.stages ?? [];
  const recentSignalCount = data.facts.length + data.alerts.length + data.nodes.length;

  return (
    <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', padding: 20 }}>
      {/* Score header */}
      {data.score && data.score.overall_score !== null && (
        <div
          className="lp-card"
          style={{
            padding: 12,
            marginBottom: 16,
            display: 'flex',
            alignItems: 'baseline',
            gap: 10,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 600, color: 'var(--ink)', fontFamily: 'var(--f-mono)' }}>
            {Number(data.score.overall_score).toFixed(1)}
            <span style={{ fontSize: 12, color: 'var(--ink-5)', marginLeft: 4 }}>/10</span>
          </div>
          <div style={{ flex: 1, fontSize: 11.5, color: 'var(--ink-3)' }}>
            {data.score.benchmark || (locale === 'it' ? 'Punteggio complessivo' : 'Overall readiness')}
          </div>
          {data.score.scored_at && (
            <div style={{ fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
              {relativeTime(data.score.scored_at, locale)}
            </div>
          )}
        </div>
      )}

      {/* 7-stage strip */}
      <div className="lp-serif" style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: 8 }}>
        {locale === 'it' ? 'Pipeline di validazione' : 'Validation pipeline'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {stages.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
            {locale === 'it' ? 'Nessuno stadio ancora avviato.' : 'No stages started yet.'}
          </div>
        ) : (
          stages.map((s) => {
            const isOpen = expandedStage === s.id;
            const verdictColor = VERDICT_COLOR[s.verdict];
            const pct = Math.round(s.completion_ratio * 100);
            return (
              <div key={s.id} className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setExpandedStage(isOpen ? null : s.id)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr 80px 60px 90px 14px',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    textAlign: 'left',
                    color: 'inherit',
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--ink-5)',
                  }}>
                    {String(s.order).padStart(2, '0')}
                  </span>
                  <span className="lp-serif" style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {s.name}
                  </span>
                  <div style={{
                    height: 6,
                    background: 'var(--paper-2)',
                    borderRadius: 3,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: verdictColor,
                      transition: 'width 200ms ease',
                    }} />
                  </div>
                  <span style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--ink-3)',
                    textAlign: 'right',
                  }}>
                    {s.skills_completed}/{s.skills_total}
                  </span>
                  <span
                    className="lp-chip"
                    style={{
                      borderColor: verdictColor,
                      color: verdictColor,
                      fontSize: 10,
                      fontFamily: 'var(--f-mono)',
                      padding: '2px 6px',
                      textAlign: 'center',
                    }}
                  >
                    {VERDICT_LABEL[s.verdict][locale]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div style={{
                    padding: '10px 12px 12px 42px',
                    borderTop: '1px solid var(--line)',
                    background: 'var(--paper-2)',
                  }}>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, marginBottom: 6 }}>
                      {locale === 'it'
                        ? `Punteggio ${s.overall_score.toFixed(1)}/10 · ${pct}% completato`
                        : `Score ${s.overall_score.toFixed(1)}/10 · ${pct}% complete`}
                    </div>
                    {s.last_signal && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginBottom: 6, fontFamily: 'var(--f-mono)' }}>
                        {s.last_signal.label} · {relativeTime(s.last_signal.at, locale)}
                      </div>
                    )}
                    {s.skills_completed === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ink-5)', fontStyle: 'italic', marginBottom: 6 }}>
                        {locale === 'it'
                          ? 'Stadio non avviato — esegui le skill da Readiness.'
                          : 'Stage not started — run its skills in Readiness.'}
                      </div>
                    )}
                    <a
                      href={`/project/${projectId}/readiness#stage-${s.order}`}
                      style={{
                        fontSize: 11,
                        color: 'var(--accent-ink)',
                        textDecoration: 'none',
                        fontFamily: 'var(--f-mono)',
                      }}
                    >
                      {locale === 'it' ? 'Apri in Readiness →' : 'Open in Readiness →'}
                    </a>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Recent signals — collapsed by default */}
      <button
        type="button"
        onClick={() => setShowRecent((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontSize: 12,
          color: 'var(--ink-3)',
          padding: '6px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{showRecent ? '▾' : '▸'}</span>
        <span className="lp-serif">
          {locale === 'it' ? 'Segnali recenti' : 'Recent signals'}
        </span>
        <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--ink-5)' }}>
          ({recentSignalCount})
        </span>
      </button>

      {showRecent && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.facts.length > 0 && (
            <section>
              <div className="lp-serif" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                {locale === 'it' ? 'Fatti' : 'Facts'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.facts.map((f) => (
                  <div key={f.id} className="lp-card" style={{ padding: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.4 }}>{f.fact}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                      <span>{f.kind}</span>
                      <span>·</span>
                      <span>conf {Math.round(f.confidence * 100)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {data.alerts.length > 0 && (
            <section>
              <div className="lp-serif" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                {locale === 'it' ? 'Alert' : 'Alerts'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.alerts.map((al) => (
                  <a
                    key={al.id}
                    href={al.source_url ?? '#'}
                    target={al.source_url ? '_blank' : undefined}
                    rel="noreferrer"
                    className="lp-card"
                    style={{
                      padding: 10,
                      textDecoration: 'none',
                      color: 'inherit',
                      display: 'block',
                      cursor: al.source_url ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 500 }}>{al.headline}</div>
                    {al.body && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4 }}>
                        {al.body.slice(0, 220)}{al.body.length > 220 ? '…' : ''}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                      <span>{al.alert_type.replace(/_/g, ' ')}</span>
                      {al.source && <><span>·</span><span>{al.source}</span></>}
                      <span>·</span>
                      <span>rel {Math.round(al.relevance_score * 100)}%</span>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {data.nodes.length > 0 && (
            <section>
              <div className="lp-serif" style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>
                {locale === 'it' ? 'Entità del grafo' : 'Graph entities'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {data.nodes.map((n) => (
                  <div key={n.id} className="lp-card" style={{ padding: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--ink-2)', fontWeight: 500 }}>{n.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
                      {n.node_type}
                    </div>
                    {n.summary && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4, lineHeight: 1.4 }}>
                        {n.summary.slice(0, 180)}{n.summary.length > 180 ? '…' : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {recentSignalCount === 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-5)', fontStyle: 'italic' }}>
              {locale === 'it' ? 'Nessun segnale ancora.' : 'No signals yet.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ActivityTab ──────────────────────────────────────────────────────────────
type ActivityTag = 'TASK' | 'ALERT' | 'SCAN' | 'CEO' | 'CHIEF' | 'YOU' | 'DRAFT' | 'AGENT';
interface ActivityEvent {
  id: string;
  at: string;
  tag: ActivityTag;
  label: string;
  body?: string;
  href?: string;
}

const TAG_STYLE: Record<ActivityTag, { bg: string; fg: string }> = {
  TASK:  { bg: 'var(--accent-wash, var(--paper-2))', fg: 'var(--accent-ink, var(--ink-2))' },
  ALERT: { bg: 'var(--clay-wash, var(--paper-2))',   fg: 'var(--clay)' },
  SCAN:  { bg: 'var(--sky-wash, var(--paper-2))',    fg: 'var(--sky, var(--ink-3))' },
  CEO:   { bg: 'var(--moss-wash, var(--paper-2))',   fg: 'var(--moss)' },
  CHIEF: { bg: 'var(--paper-2)',                     fg: 'var(--ink-2)' },
  YOU:   { bg: 'var(--paper-3, var(--paper-2))',     fg: 'var(--ink-2)' },
  DRAFT: { bg: 'var(--accent-wash, var(--paper-2))', fg: 'var(--accent-ink, var(--ink-2))' },
  AGENT: { bg: 'var(--moss-wash, var(--paper-2))',   fg: 'var(--moss)' },
};

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

function ActivityTab({
  projectId,
  locale,
  onJumpTasks,
}: {
  projectId: string;
  locale: 'en' | 'it';
  onJumpTasks: () => void;
}) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/activity`);
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      const inner = body?.data ?? body;
      setEvents(Array.isArray(inner.events) ? inner.events : []);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    const onChange = () => load();
    window.addEventListener('lp-tasks-changed', onChange);
    window.addEventListener('lp-credits-changed', onChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('lp-tasks-changed', onChange);
      window.removeEventListener('lp-credits-changed', onChange);
    };
  }, [load]);

  if (loading && events.length === 0) {
    return (
      <div style={{ flex: 1, padding: 40, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it' ? 'Caricamento attività…' : 'Loading activity…'}
      </div>
    );
  }
  if (err) {
    return (
      <div style={{ flex: 1, padding: 24, fontSize: 12, color: 'var(--clay)', textAlign: 'center' }}>
        {err}
      </div>
    );
  }
  if (events.length === 0) {
    return (
      <div style={{ flex: 1, padding: 40, fontSize: 12, color: 'var(--ink-5)', textAlign: 'center', lineHeight: 1.5 }}>
        {locale === 'it'
          ? 'Nessuna attività ancora — il heartbeat parte ogni giorno e gli eventi della chat compaiono qui.'
          : 'No activity yet — the heartbeat runs daily and chat events stream here.'}
      </div>
    );
  }

  return (
    <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {events.map((ev) => {
          const style = TAG_STYLE[ev.tag];
          const clickable = Boolean(ev.href) || ev.tag === 'TASK' || ev.tag === 'DRAFT' || ev.tag === 'AGENT';
          const onClick = () => {
            if (ev.href) {
              window.open(ev.href, '_blank', 'noreferrer');
            } else if (ev.tag === 'TASK' || ev.tag === 'DRAFT' || ev.tag === 'AGENT') {
              onJumpTasks();
            }
          };
          return (
            <div
              key={ev.id}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : undefined}
              onClick={clickable ? onClick : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onClick(); } : undefined}
              style={{
                display: 'grid',
                gridTemplateColumns: '70px 60px 1fr',
                gap: 8,
                alignItems: 'baseline',
                padding: '6px 8px',
                borderRadius: 4,
                cursor: clickable ? 'pointer' : 'default',
                fontFamily: 'var(--f-mono)',
                fontSize: 11.5,
              }}
              className={clickable ? 'lp-row-hover' : undefined}
            >
              <span style={{ color: 'var(--ink-5)' }}>{formatTime(ev.at)}</span>
              <span
                style={{
                  background: style.bg,
                  color: style.fg,
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  textAlign: 'center',
                  lineHeight: 1.6,
                }}
              >
                {ev.tag}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.label}
                </div>
                {ev.body && (
                  <div style={{ color: 'var(--ink-5)', fontSize: 11, marginTop: 2, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                    {ev.body}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CanvasHeader({
  count,
  locale,
  tab,
  onTabChange,
}: {
  count: number;
  locale: 'en' | 'it';
  tab: CanvasTab;
  onTabChange: (next: CanvasTab) => void;
}) {
  const tabs: { id: CanvasTab; label: { en: string; it: string } }[] = [
    { id: 'latest',       label: { en: 'Latest',       it: 'Ultimo' } },
    { id: 'tasks',        label: { en: 'Tasks',        it: 'Task' } },
    { id: 'intelligence', label: { en: 'Intelligence', it: 'Intelligence' } },
    { id: 'activity',     label: { en: 'Activity',     it: 'Attività' } },
  ];
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
        gap: 6,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, marginRight: 6 }}>Canvas</span>
      {tabs.map((t) => {
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className="lp-chip"
            style={{
              cursor: 'pointer',
              border: '1px solid ' + (active ? 'var(--accent-ink)' : 'var(--line-2)'),
              background: active ? 'var(--accent)' : 'var(--paper)',
              color: active ? 'var(--ink)' : 'var(--ink-3)',
              fontWeight: active ? 600 : 400,
            }}
          >
            {t.label[locale]}
          </button>
        );
      })}
      <span style={{ flex: 1 }} />
      {tab === 'latest' && (
        <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {count === 0
            ? (locale === 'it' ? 'nessun artefatto ancora' : 'no artifacts yet')
            : `${count} artifact${count === 1 ? '' : 's'}`}
        </span>
      )}
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

function ArtifactCard({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  // Self-contained interactive proposal cards (Approve / Edit / Dismiss) want
  // full width without the generic card chrome around them. Render bare —
  // ArtifactRenderer routes the type to its dedicated card component.
  if (artifact.type === 'monitor-proposal' || artifact.type === 'budget-proposal') {
    return (
      <div style={{ gridColumn: 'span 6' }}>
        <ArtifactRenderer
          artifact={artifact}
          onAction={(a, p) => { void onAction(a, p); }}
          onEntityDiscovered={() => { /* canvas already shows the card; no-op */ }}
          onWorkflowDiscovered={() => { /* canvas already shows the card; no-op */ }}
        />
      </div>
    );
  }

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
        <ArtifactBody artifact={artifact} onAction={onAction} />
      </div>
    </div>
  );
}

function ArtifactBody({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  // Delegate to the canonical renderer used by ChatMessage, SkillOutputRenderer,
  // and the brief page. Keeps Canvas in sync with all 16 supported types and
  // fixes the prior raw-JSON fallback for pie-chart / sensitivity-slider /
  // score-badge / entity-card / etc. Charts get a SourcesFooter for free.
  return (
    <ArtifactRenderer
      artifact={artifact}
      onAction={(a, p) => { void onAction(a, p); }}
      onEntityDiscovered={() => { /* canvas already shows the card; no-op */ }}
      onWorkflowDiscovered={() => { /* canvas already shows the card; no-op */ }}
    />
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
