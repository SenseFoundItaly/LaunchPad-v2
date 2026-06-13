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
 * The agent can list_ecosystem_alerts, get_project_metrics, queue_draft_for_review, etc.
 * without changing this component.
 */

import { use, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from 'react';
import api from '@/api';
import { useChat, chatStoreHydrated, markChatHydrated } from '@/hooks/useChat';
import { useProject } from '@/hooks/useProject';
import { splitOptionLabel } from '@/components/chat/option-label';
import { parseMessageContent } from '@/lib/artifact-parser';
import type { Artifact, ArtifactType, ValidationProposalArtifact } from '@/types/artifacts';
import ValidationProposalCard from '@/components/chat/artifacts/ValidationProposalCard';
import { Canvas } from '@/components/canvas/Canvas';
import { TopBar, NavRail } from '@/components/design/chrome';
// CreditsBadge is now mounted globally inside TopBar (see chrome.tsx) so we
// don't import or insert it here. The `right` slot below only carries the
// chat-specific controls (model picker, context export).
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { useKnowledgeCount } from '@/hooks/useKnowledgeCount';
import { checkActionPrompt } from '@/lib/journey-prompts';
import { buildContextMarkdown } from '@/lib/context-export';
import type { ContextExportData } from '@/lib/context-export';
import { openPrintPreview } from '@/lib/print-utils';
import {
  Pill,
  StatusBar,
  Icon,
  I,
  IconBtn,
} from '@/components/design/primitives';

// Artifact types that render INLINE in the chat bubble (interactive CTAs)
// rather than in the right-side Canvas. Anything not listed stays in Canvas.
const INLINE_ARTIFACT_TYPES = new Set<ArtifactType>([
  'option-set', 'action-suggestion', 'task',
  'monitor-proposal', 'budget-proposal', 'validation-proposal',
  'skill-suggestion', 'knowledge-suggestion',
]);

// Approval gates that carry their own Apply/Skip decision and ACTUALLY render
// inline today. While one is pending in a turn, the founder's next action IS
// that card — so the proactive "what next?" suggestions below are noise that
// competes with it. monitor/budget proposals are intentionally NOT here:
// InlineArtifact renders nothing for them (they're Inbox-primary), so
// suppressing suggestions on those turns would leave the founder with no
// actionable surface. Add them here only once they render inline.
const GATE_ARTIFACT_TYPES = new Set<ArtifactType>([
  'validation-proposal',
]);
// Proactive next-step suggestions. Suppressed in any turn that also renders a
// gate card (the founder should resolve the gate first, then we resume
// suggesting). The QuickReplies fallback never fires here either, because the
// gate card keeps the inline list non-empty.
const SUGGESTION_ARTIFACT_TYPES = new Set<ArtifactType>([
  'option-set', 'action-suggestion', 'skill-suggestion', 'knowledge-suggestion',
]);

// Message paging: long threads (40+ screens) render only this many trailing
// messages by default; a quiet expander at the top mounts the rest on demand.
// Pure render-window — the full `messages` array stays in memory (artifact
// classification, context export, and the canvas all still see every turn).
const VISIBLE_MESSAGE_TAIL = 25;

// Smart autoscroll: how close to the bottom (px) the reader must be for new
// content to keep auto-pinning the scroll position.
const NEAR_BOTTOM_PX = 150;

// Artifact types rendered ELSEWHERE as a single pinned surface, so they must
// NOT also stream into the Canvas as department cards. `idea-canvas` persists
// to the idea_canvas table (artifact-persistence) and is shown once by the
// pinned IdeaCanvasHeader at the top of the Canvas — without this filter, every
// idea-canvas the agent emits renders an extra (often stale) duplicate card
// next to the live pinned snapshot.
const PINNED_ARTIFACT_TYPES = new Set<ArtifactType>(['idea-canvas']);

function classifyArtifacts(content: string): { inline: Artifact[]; canvas: Artifact[] } {
  const segments = parseMessageContent(content);
  const all = segments
    .filter((s) => s.type === 'artifact')
    .map((s) => (s as { type: 'artifact'; artifact: Artifact }).artifact);
  return {
    inline: all.filter((a) => INLINE_ARTIFACT_TYPES.has(a.type)),
    canvas: all.filter(
      (a) => !INLINE_ARTIFACT_TYPES.has(a.type) && !PINNED_ARTIFACT_TYPES.has(a.type),
    ),
  };
}

interface HistoryResp {
  success: boolean;
  data?: Array<{ id: string; role: string; content: string; timestamp: string; tools_json?: string }>;
}

// ---------------------------------------------------------------------------
// ContextExportBtn — download / print context snapshot
// ---------------------------------------------------------------------------

function ContextExportBtn({
  projectId,
  project,
  messages,
  artifacts,
  disabled,
}: {
  projectId: string;
  project: { name: string; status: string } | null;
  messages: Array<{ role: string; content: string; timestamp?: string }>;
  artifacts: Artifact[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function gatherData(): Promise<ContextExportData> {
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const artifactList = artifacts.map((a) => ({ type: a.type, title: (a as unknown as { title?: string }).title || a.id }));

    try {
      const res = await fetch(`/api/projects/${projectId}/context-export`);
      const body = await res.json();
      if (res.ok && body?.data) {
        const d = body.data;
        return {
          project: { name: d.project?.name || project?.name || '', description: d.project?.description, status: d.project?.status || project?.status || '' },
          date,
          score: d.score ?? null,
          stages: d.stages ?? [],
          facts: d.facts ?? [],
          alerts: d.alerts ?? [],
          nodes: d.nodes ?? [],
          briefs: d.briefs ?? [],
          tasks: d.tasks ?? [],
          risks: d.risks ?? [],
          artifacts: artifactList,
          messages: d.messages ?? messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
        };
      }
    } catch { /* fallback below */ }

    // Fallback: export whatever is available client-side
    return {
      project: { name: project?.name || '', status: project?.status || '' },
      date,
      score: null,
      stages: [],
      facts: [],
      alerts: [],
      nodes: [],
      briefs: [],
      tasks: [],
      risks: [],
      artifacts: artifactList,
      messages: messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    };
  }

  async function handleDownload() {
    setOpen(false);
    const data = await gatherData();
    const md = buildContextMarkdown(data);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project?.name || 'export').replace(/\s+/g, '-').toLowerCase()}-context-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrint() {
    setOpen(false);
    const data = await gatherData();
    const md = buildContextMarkdown(data);
    openPrintPreview(`${project?.name || 'Context'}`, md);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <IconBtn
        d={I.download}
        title="Export context"
        onClick={() => setOpen((v) => !v)}
        style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: '100%',
            marginTop: 4,
            width: 170,
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--r-m)',
            boxShadow: '0 4px 12px rgba(0,0,0,.12)',
            zIndex: 50,
            padding: '4px 0',
          }}
        >
          <button
            type="button"
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--ink-2)',
              fontFamily: 'var(--f-sans)',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget.style.background = 'var(--paper-2)'); }}
            onMouseLeave={(e) => { (e.currentTarget.style.background = 'transparent'); }}
          >
            <Icon d={I.download} size={14} stroke={1.4} />
            Download .md
          </button>
          <button
            type="button"
            onClick={handlePrint}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--ink-2)',
              fontFamily: 'var(--f-sans)',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget.style.background = 'var(--paper-2)'); }}
            onMouseLeave={(e) => { (e.currentTarget.style.background = 'transparent'); }}
          >
            <Icon d={I.printer} size={14} stroke={1.4} />
            Print / PDF
          </button>
        </div>
      )}
    </div>
  );
}

export default function CopilotChatPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { project } = useProject(projectId);
  // One project = one chat. The chat_messages.step column is fixed to 'chat'
  // (multi-thread routing was removed — see commit history).
  const step = 'chat';
  const { messages, isStreaming, sendMessage: sendMessageRaw, setMessages, messageCosts } = useChat(projectId, step);
  const [input, setInput] = useState('');
  // Init true when the store already holds this thread (tab-return) so we don't
  // flash "Loading history…" or re-fetch. Fresh mount / full refresh → false.
  const [historyLoaded, setHistoryLoaded] = useState(() => chatStoreHydrated(projectId, step));
  const scrollRef = useRef<HTMLDivElement>(null);
  // Turn-linked canvas: which chat message is hovered (null = none).
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  // --- Message paging -------------------------------------------------------
  // Render only the trailing VISIBLE_MESSAGE_TAIL messages by default; the
  // expander at the top of the thread mounts the rest. Client-side only — no
  // API change (history is already fully loaded into `messages`).
  const [showAllMessages, setShowAllMessages] = useState(false);
  // Scroll anchor captured at expand-click so prepended content doesn't jump
  // the reader's position (compensated before paint in the layout effect).
  const expandAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  // Render window: everything stays in `messages` (artifact maps below are
  // computed over the FULL array, so inline artifacts in older messages still
  // work when expanded) — only the rendered list is windowed. Memoized so the
  // window-slide layout effect re-runs on real thread changes, not on
  // unrelated renders (e.g. composer keystrokes).
  const hiddenCount = showAllMessages ? 0 : Math.max(0, messages.length - VISIBLE_MESSAGE_TAIL);
  const visibleMessages = useMemo(
    () => (hiddenCount > 0 ? messages.slice(hiddenCount) : messages),
    [messages, hiddenCount],
  );
  // Per-commit offsetTop snapshot of every rendered message + the window-start
  // id — the "previous frame" the slide-compensation effect diffs against.
  const msgOffsetsRef = useRef<{ firstId: string | null; offsets: Map<string, number> }>({
    firstId: null,
    offsets: new Map(),
  });

  // --- Smart autoscroll ------------------------------------------------------
  // Refs (not state) so per-SSE-chunk updates never trigger extra renders:
  //   isNearBottomRef — reader's position as of the last scroll event
  //                     (programmatic pins also fire onScroll, keeping it true)
  //   forceScrollRef  — one-shot pin: own send, history restore, pill click
  // showJumpPill is handler-driven only (onScroll / clicks) — never set from
  // an effect, so the stream loop stays free of state-update cascades.
  const isNearBottomRef = useRef(true);
  const forceScrollRef = useRef(false);
  const [showJumpPill, setShowJumpPill] = useState(false);

  // Every send path (composer, retry, quick-reply chips, option clicks,
  // canvas skill kickoffs) is a deliberate jump to the live edge — queue a
  // one-shot pin so the user's own turn always lands in view, even if they
  // had scrolled up. Wrapping here centralizes it instead of sprinkling the
  // flag across call sites.
  const sendMessage = useCallback((content: string) => {
    forceScrollRef.current = true;
    sendMessageRaw(content);
  }, [sendMessageRaw]);

  // Fire lp-actions-changed immediately when streaming ends so downstream
  // surfaces (badge counts, inline cards) refetch without waiting for poll.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, projectId]);

  const locale = (project as unknown as { locale?: string })?.locale === 'it' ? 'it' : 'en';

  // Load existing chat history for this project.
  // Race-guard: a stale response (e.g. project switch mid-fetch) is ignored.
  //
  // Tab-return guard: if the chat store already holds this thread (we navigated
  // back to the Co-pilot tab, or a stream ran / completed while we were away on
  // Know/Home), DON'T reload history — that would clobber the in-flight or
  // just-returned response. The module store IS the live thread; trust it.
  // History only loads on the first visit and after a full page refresh (which
  // resets the module store), rebuilding from the server-persisted rows.
  useEffect(() => {
    // Store already holds this thread (tab-return): skip the reload entirely.
    // historyLoaded was initialized true above, so no "Loading…" flash.
    if (chatStoreHydrated(projectId, step)) return;
    const controller = new AbortController();
    api.get<HistoryResp>(
      `/api/chat/history?project_id=${projectId}&step=${encodeURIComponent(step)}`,
      { signal: controller.signal, timeout: 15_000 },
    )
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        // A send may have started while history was in flight — don't overwrite
        // the fresh stream with stale history.
        if (chatStoreHydrated(projectId, step)) return;
        const restored = data.success && Array.isArray(data.data) && data.data.length > 0
          ? data.data.map((m, i) => ({
            id: m.id ?? `restored_${i}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp,
            tools: m.tools_json ? JSON.parse(m.tools_json) : undefined,
          }))
          : [];
        // Restored history replaces the whole thread: collapse paging, hide
        // the jump pill, and force one pin-to-bottom. The force flag matters
        // because the component instance survives projectId param changes —
        // a stale "scrolled up" reading from the previous thread must not
        // suppress the initial scroll of the new one. (Refs are set BEFORE
        // setMessages so the [messages] effect sees them in this render pass.)
        forceScrollRef.current = true;
        setShowAllMessages(false);
        setShowJumpPill(false);
        setMessages(restored);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('[chat] history fetch failed:', (err as Error).message);
        forceScrollRef.current = true;
        setShowAllMessages(false);
        setShowJumpPill(false);
        setMessages([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          // Remember this thread is loaded so a tab-return doesn't reload (and
          // clobber) it. Survives until a full page refresh resets the store.
          markChatHydrated(projectId, step);
          setHistoryLoaded(true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [projectId, step, setMessages]);

  // Smart autoscroll — replaces the old unconditional scroll-to-bottom.
  // Only pin to the newest content when the reader is already near the bottom
  // (or a one-shot force pin is queued: own send / history restore). When the
  // reader has scrolled up, their position is left completely untouched —
  // streaming chunks never yank them away from earlier content; the
  // handler-driven "Jump to latest" pill is their way back.
  //
  // Stream-safety: this effect runs on every SSE chunk (each chunk produces a
  // new `messages` array), but it's pure DOM synchronization — one scrollTop
  // write, zero setState — so the stream loop causes no render cascades.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (forceScrollRef.current || isNearBottomRef.current) {
      forceScrollRef.current = false;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  // Track the reader's position. Fires for user scrolls AND our programmatic
  // pins (browsers emit scroll events for scrollTop writes), so the ref stays
  // truthful in both directions. The pill simply means "not at the live edge":
  // it appears when the reader scrolls up past the threshold and dismisses
  // when they return (manually or via the pill). React bails out of the
  // setState when the boolean is unchanged, so this renders only on
  // boundary crossings — not per scroll frame.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    isNearBottomRef.current = near;
    setShowJumpPill(!near);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Instant (not smooth) on purpose: a smooth animation across a long
    // thread would let intermediate scroll frames resurrect the pill and
    // fight incoming stream chunks. Instant lands at the live edge in one
    // frame; the force flag covers a chunk growing scrollHeight same-tick.
    isNearBottomRef.current = true;
    forceScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowJumpPill(false);
  }, []);

  const expandEarlier = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      expandAnchorRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
    }
    setShowAllMessages(true);
  }, []);

  // Window-slide anchor compensation.
  //
  // While the thread is collapsed, every appended message advances the render
  // window (`hiddenCount` grows), unmounting the oldest visible message. A
  // reader pinned to the bottom never feels it (the autoscroll effect re-pins
  // on the same commit); a reader who scrolled UP would see the text shift
  // under them by exactly the unmounted height.
  //
  // Same pre-paint pattern as the expander effect below, but automatic: every
  // commit records each rendered message's offsetTop; when the window START
  // (first visible message id) changes while the reader is NOT pinning to
  // bottom, the first message present in both commits anchors the window and
  // scrollTop shifts by how far its offsetTop moved (= the height removed
  // above it). offsetTop is layout-static — ancestor scroll position doesn't
  // affect it — so the delta isolates the removed-above height even though a
  // new message was appended below in the same commit.
  //
  // Can't fight the autoscroll effect: compensation runs only when
  // `!forceScrollRef && !isNearBottomRef` — the exact negation of autoscroll's
  // pin predicate, read here in a layout effect, i.e. BEFORE the (passive)
  // autoscroll effect clears the force flag — so per commit at most one of
  // the two writes scrollTop. The expander commit is excluded via
  // expandAnchorRef: this effect is declared first, so the flag is still set
  // when it runs and the click-anchored effect below keeps owning that case
  // (no double compensation).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const prev = msgOffsetsRef.current;
    const firstId = visibleMessages[0]?.id ?? null;

    // One DOM pass: collect this commit's message offsets (≤ tail size reads).
    const offsets = new Map<string, number>();
    el.querySelectorAll<HTMLElement>('[data-message-id]').forEach((node) => {
      const id = node.dataset.messageId;
      if (id) offsets.set(id, node.offsetTop);
    });

    const windowSlid = prev.firstId !== null && firstId !== null && prev.firstId !== firstId;
    const pinningToBottom = forceScrollRef.current || isNearBottomRef.current;
    if (windowSlid && !pinningToBottom && expandAnchorRef.current === null) {
      for (const m of visibleMessages) {
        const prevTop = prev.offsets.get(m.id);
        const nextTop = offsets.get(m.id);
        if (prevTop === undefined || nextTop === undefined) continue;
        const removedAbove = prevTop - nextTop;
        if (removedAbove !== 0) {
          el.scrollTop = Math.max(0, el.scrollTop - removedAbove);
        }
        break; // first shared message anchors the whole window
      }
    }

    msgOffsetsRef.current = { firstId, offsets };
  }, [visibleMessages]);

  // After the older messages mount ABOVE the viewport, compensate scrollTop by
  // exactly the added height — before paint — so the reader stays anchored on
  // the message they were looking at when they clicked the expander.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const anchor = expandAnchorRef.current;
    if (!showAllMessages || !el || !anchor) return;
    expandAnchorRef.current = null;
    el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight);
  }, [showAllMessages]);

  // Split parsed artifacts: option-set / action-suggestion render INLINE in
  // the chat bubble; everything else goes to the right Canvas.
  // Inline cards are kept per-message so the user can still interact with old
  // CTAs after the agent has streamed a follow-up.
  //
  // CanvasEntry tracks provenance: which message produced which artifact and
  // which turn (sequential assistant-message index) it belongs to. This
  // powers turn-divider chips and hover-highlighting in the canvas.
  interface CanvasEntry {
    artifact: Artifact;
    sourceMessageId: string;
    turnIndex: number;
  }
  const { canvasEntries, canvasArtifacts, inlineArtifactsByMsgId } = useMemo(() => {
    const inlineMap = new Map<string, Artifact[]>();
    const canvasById = new Map<string, CanvasEntry>();
    let turnIndex = 0;
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.content) continue;
      const split = classifyArtifacts(m.content);
      // Gate present → drop the proactive suggestion cards from this turn so the
      // Apply/Skip decision stands alone (the gate card itself stays).
      const inline = split.inline.some((a) => GATE_ARTIFACT_TYPES.has(a.type))
        ? split.inline.filter((a) => !SUGGESTION_ARTIFACT_TYPES.has(a.type))
        : split.inline;
      if (inline.length > 0) inlineMap.set(m.id, inline);
      // Accumulate canvas artifacts across all messages. Later messages
      // with the same artifact id overwrite earlier ones (e.g. solve-progress
      // updates use the same id "solve_1").
      for (const a of split.canvas) {
        canvasById.set(a.id, { artifact: a, sourceMessageId: m.id, turnIndex });
      }
      if (split.canvas.length > 0) turnIndex++;
    }
    const entries = Array.from(canvasById.values());
    return {
      canvasEntries: entries,
      canvasArtifacts: entries.map((e) => e.artifact),
      inlineArtifactsByMsgId: inlineMap,
    };
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
   *   - 'monitor:apply' → POST /api/projects/{id}/actions/{actionId}
   *     with transition='apply' (+ optional edited_payload for
   *     Edit-before-apply flows). The configure_monitor executor fires
   *     server-side and creates the monitors row.
   *   - 'monitor:dismiss' → transition='reject' (marks pending_action as
   *     rejected; records a preference fact so the agent learns).
   *
   * Throws on non-2xx so the calling card can flip to its error state.
   * Returns void on success so MonitorProposalCard's resolved-applied /
   * resolved-dismissed transitions fire.
   *
   * Other artifact actions (select-option, trigger-action, etc.) stay
   * routed to sendMessage (legacy pattern) — TODO: migrate those to their
   * own server routes in v2 for symmetry.
   */
  const handleArtifactAction = useCallback(
    async (action: string, payload: Record<string, unknown>): Promise<void> => {
      // knowledge:apply — the founder clicked Apply / Dismiss on a knowledge
      // card (insight / entity / comparison / metric) whose proposal is
      // pending. Re-added 2026-06-11: knowledge no longer auto-applies; the
      // card carries Apply · 2 credits / Dismiss. PATCHes the unified knowledge
      // endpoint, which flips reviewed_state and (server-side, on
      // pending→applied) debits KNOWLEDGE_APPLY_CREDITS. Apply broadcasts both
      // lp-actions-changed (inbox row may exist) and lp-knowledge-changed +
      // lp-credits-changed (Knowledge surface + credit badge refetch).
      if (action === 'knowledge:apply') {
        const itemId = String(payload.item_id ?? '');
        if (!itemId) throw new Error('Missing item_id on knowledge:apply');
        const state = payload.state === 'rejected' ? 'rejected' : 'applied';
        const res = await fetch(
          `/api/projects/${projectId}/knowledge/${encodeURIComponent(itemId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Knowledge ${state} failed with status ${res.status}`);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
          window.dispatchEvent(new CustomEvent('lp-knowledge-changed', { detail: { projectId } }));
          if (state === 'applied') {
            window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
          }
        }
        return;
      }

      // knowledge:apply-inline — the founder clicked "Apply to intelligence" on
      // an inline knowledge-suggestion card (a prose-stated fact, no persisted
      // row). POST /knowledge { apply: true } creates the fact as 'applied' and
      // debits the 2 credits server-side. Broadcasts the same refetch events.
      if (action === 'knowledge:apply-inline') {
        const fact = String(payload.fact ?? '').trim();
        if (!fact) throw new Error('Missing fact on knowledge:apply-inline');
        const res = await fetch(`/api/projects/${projectId}/knowledge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: fact,
            kind: typeof payload.kind === 'string' ? payload.kind : 'observation',
            apply: true,
            sources: Array.isArray(payload.sources) ? payload.sources : [],
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Apply failed with status ${res.status}`);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-knowledge-changed', { detail: { projectId } }));
          window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
        }
        return;
      }

      // Generic pending-action apply/reject from inline chat-bubble cards
      if (action === 'action:apply' || action === 'action:reject') {
        const pendingActionId = String(payload.pending_action_id ?? '');
        if (!pendingActionId) throw new Error(`Missing pending_action_id on ${action}`);
        const transition = action === 'action:apply' ? 'apply' : 'reject';
        const res = await fetch(
          `/api/projects/${projectId}/actions/${pendingActionId}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transition }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Action failed with status ${res.status}`);
        }
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
        }
        return;
      }
      if (
        action === 'monitor:apply' || action === 'monitor:dismiss' ||
        action === 'budget:apply' || action === 'budget:dismiss' ||
        action === 'validation:apply' || action === 'validation:dismiss'
      ) {
        const pendingActionId = String(payload.pending_action_id ?? '');
        if (!pendingActionId) throw new Error(`Missing pending_action_id on ${action}`);
        const isApply = action === 'monitor:apply' || action === 'budget:apply' || action === 'validation:apply';
        const transition = isApply ? 'apply' : 'reject';
        const body: Record<string, unknown> = { transition };
        if (isApply && payload.overrides) {
          body.edited_payload = payload.overrides;
        }
        if (!isApply && typeof payload.reason === 'string') {
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
        if (typeof window !== 'undefined') {
          // Broadcast so other surfaces (badge counts, inline cards) refetch.
          window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
          // Budget cap changed → CreditsBadge listens for this event to refetch.
          if (action === 'budget:apply') {
            window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
          }
          // Applying validation evidence writes canvas/knowledge, debits credits,
          // and moves the spine — nudge the Canvas, Knowledge count, and credits.
          if (action === 'validation:apply') {
            window.dispatchEvent(new CustomEvent('lp-knowledge-changed', { detail: { projectId } }));
            window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
          }
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
        // Broadcast so other surfaces (badge counts, inline cards) refetch.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('lp-tasks-changed', { detail: { projectId, artifactId, verb } }));
          window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
        }
        return;
      }
      // skill:run — the founder clicked Run on an EPHEMERAL inline
      // skill-suggestion card. Run the skill in real time via POST /skills?run=1
      // (skill_completions + section_scores), WITHOUT any pending_action. The
      // credit cost was shown on the button before the click, so this is
      // consented spend. The card manages its own running/done state; on
      // success we broadcast so spine / readiness surfaces refetch.
      if (action === 'skill:run') {
        const skillId = String(payload.skill_id ?? '');
        if (!skillId) throw new Error('Missing skill_id on skill:run');
        const reqBody: Record<string, unknown> = { skill_id: skillId, run: true };
        if (typeof payload.context === 'string' && payload.context) {
          reqBody.context = payload.context;
        }
        const res = await fetch(`/api/projects/${projectId}/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Skill run failed with status ${res.status}`);
        }
        if (typeof window !== 'undefined') {
          // Skill writes skill_completions + section_scores → spine, readiness,
          // and skill surfaces should refetch.
          window.dispatchEvent(new CustomEvent('lp-skills-changed', { detail: { projectId, skillId } }));
          window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
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
        projectId={projectId}
        breadcrumb={[project?.name || '', 'Co-pilot']}
        right={
          <>
            {(project as { access_kind?: string } | null)?.access_kind === 'member' && (
              <span
                className="lp-mono"
                title={
                  (project as { owner_email?: string | null } | null)?.owner_email
                    ? `Shared by ${(project as { owner_email?: string | null }).owner_email}`
                    : 'Shared with you'
                }
                style={{
                  fontSize: 10,
                  color: 'var(--accent-ink)',
                  background: 'var(--accent-wash)',
                  padding: '2px 7px',
                  borderRadius: 999,
                  letterSpacing: 0.3,
                  textTransform: 'uppercase',
                }}
              >
                Shared{(project as { owner_email?: string | null } | null)?.owner_email
                  ? ` · ${(project as { owner_email: string }).owner_email}`
                  : ''}
              </span>
            )}
            {isStreaming && <Pill kind="live" dot>streaming</Pill>}
            <ContextExportBtn
              projectId={projectId}
              project={project}
              messages={messages}
              artifacts={canvasArtifacts}
              disabled={isStreaming}
            />
          </>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="chat" inboxBadge={inboxBadge} chatStreaming={isStreaming} />

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
          <ChatHeader project={project} locale={locale} projectId={projectId} />

          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div
              ref={scrollRef}
              className="lp-scroll"
              onScroll={handleScroll}
              style={{ flex: 1, overflow: 'auto', padding: '16px 20px 20px' }}
            >
              {!historyLoaded && messages.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: 20, textAlign: 'center' }}>
                  Loading history…
                </div>
              ) : messages.length === 0 ? (
                <ChatEmptyState
                  locale={locale}
                  projectId={projectId}
                  onPick={(s) => setInput(s)}
                />
              ) : (
                <>
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={expandEarlier}
                      className="lp-mono"
                      style={{
                        display: 'block',
                        margin: '0 auto 16px',
                        padding: '4px 12px',
                        fontSize: 10.5,
                        letterSpacing: 0.3,
                        color: 'var(--ink-4)',
                        background: 'var(--paper-2)',
                        border: '1px solid var(--line)',
                        borderRadius: 999,
                        cursor: 'pointer',
                      }}
                    >
                      {locale === 'it'
                        ? `Mostra conversazione precedente (${hiddenCount} in più)`
                        : `Show earlier conversation (${hiddenCount} more)`}
                    </button>
                  )}
                  {visibleMessages.map((m) => (
                    <Msg
                      key={m.id}
                      messageId={m.id}
                      who={m.role === 'user' ? 'user' : 'ai'}
                      agent="Chief"
                      streaming={m.role === 'assistant' && isStreaming && m === messages[messages.length - 1]}
                      tools={m.tools}
                      rawContent={m.content}
                      inlineArtifacts={inlineArtifactsByMsgId.get(m.id)}
                      onArtifactAction={handleArtifactAction}
                      onQuickReply={!isStreaming ? sendMessage : undefined}
                      onMouseEnter={() => setFocusedMessageId(m.id)}
                      onMouseLeave={() => setFocusedMessageId((prev) => prev === m.id ? null : prev)}
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
                  ))}
                </>
              )}
            </div>
            {showJumpPill && (
              <button
                type="button"
                onClick={jumpToLatest}
                title={locale === 'it' ? 'Vai all\'ultimo messaggio' : 'Scroll to the latest message'}
                style={{
                  position: 'absolute',
                  bottom: 14,
                  right: 16,
                  zIndex: 20,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  fontSize: 11.5,
                  fontWeight: 500,
                  fontFamily: 'inherit',
                  color: 'var(--paper)',
                  background: 'var(--ink)',
                  border: 'none',
                  borderRadius: 999,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0,0,0,.18)',
                }}
              >
                <Icon d={I.arrow} size={11} style={{ transform: 'rotate(90deg)' }} />
                {locale === 'it' ? 'Vai all\'ultimo' : 'Jump to latest'}
              </button>
            )}
          </div>

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onKeyDown={handleKey}
            disabled={isStreaming}
            locale={locale}
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
          <Canvas
            projectId={projectId}
            locale={locale}
            canvasEntries={canvasEntries}
            messages={messages}
            handleArtifactAction={handleArtifactAction}
            focusedMessageId={focusedMessageId}
            onSkillClick={(label) => {
              // Mirror the inline option-set "select-option" convention so the
              // agent runs the skill the founder just clicked. See route.ts
              // TIER 3 PRIORITY RULES: "When the founder explicitly asks to run
              // a skill: route through 'I choose: <kickoff>' click path."
              if (!isStreaming) sendMessage(`I choose: ${label}`);
            }}
            onPickPrompt={(prompt) => {
              // A substep was clicked in the (right-pane) Canvas — load the
              // prompt into the (left-pane) composer and focus it so the founder
              // sees it ready to send. No auto-send: they review/edit + send.
              setInput(prompt);
              if (typeof document !== 'undefined') {
                const tas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
                const composer = tas.find((t) => /co-pilot/i.test(t.placeholder)) ?? tas[0];
                composer?.focus();
                composer?.scrollIntoView({ block: 'nearest' });
              }
            }}
          />
        </div>
      </div>

      {/* Slimmed (2026-06): streaming/idle only — the artifact count and tz
          segments were founder-facing noise. */}
      <StatusBar heartbeatLabel={isStreaming ? 'streaming' : 'idle'} />
    </div>
  );
}

// =============================================================================
// Chat header + empty + composer + message
// =============================================================================

function ChatHeader({
  project,
  locale,
  projectId,
}: {
  project: unknown;
  locale: 'en' | 'it';
  projectId: string;
}) {
  const p = project as { name?: string; description?: string } | null;
  const subtitle = useCurrentSubtask(projectId, locale);
  return (
    <div style={{ padding: '14px 20px 12px', borderBottom: '1px solid var(--line)' }}>
      <h2
        className="lp-serif"
        style={{ fontSize: 20, fontWeight: 400, letterSpacing: -0.3, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        {p?.name || ''}
        <span className="lp-dot lp-pulse" style={{ background: 'var(--moss)', width: 6, height: 6 }} />
      </h2>
      {subtitle && (
        <div
          className="lp-mono"
          style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

// The subtitle under the project name = what the founder is validating RIGHT
// NOW: the active stage's first unmet substep (its check label). Was hardcoded
// "Validate ICP", which lied once the founder moved past ICP. Reacts to
// lp-actions-changed so it advances as substeps clear (same signal SpineSection
// uses). Returns null while loading / when nothing is active, so the header
// shows no stale placeholder.
function useCurrentSubtask(projectId: string, locale: 'en' | 'it'): string | null {
  const [subtitle, setSubtitle] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/projects/${projectId}/stages`);
        const body = await res.json();
        if (cancelled) return;
        const inner = body?.data ?? body;
        const evals: Array<{
          stage: { label: string };
          status: string;
          results: Array<{ check: { label: string }; result: { passed: boolean } }>;
        }> = Array.isArray(inner?.evaluations) ? inner.evaluations : [];
        const active = evals.find((e) => e.status === 'active');
        if (!active) {
          // No active stage: either nothing started or everything's validated.
          const allDone = evals.length > 0 && evals.every((e) => e.status === 'done');
          setSubtitle(allDone ? (locale === 'it' ? 'Tutte le tappe validate' : 'All stages validated') : null);
          return;
        }
        const openCheck = active.results.find((r) => !r.result.passed);
        if (openCheck) {
          setSubtitle(
            (locale === 'it' ? 'In validazione · ' : 'Validating · ') + openCheck.check.label,
          );
        } else {
          // Active stage with every substep passed — about to advance.
          setSubtitle(active.stage.label + (locale === 'it' ? ' · pronto ad avanzare' : ' · ready to advance'));
        }
      } catch {
        /* leave whatever was there; non-fatal */
      }
    }
    load();
    const handler = () => { if (!cancelled) load(); };
    window.addEventListener('lp-actions-changed', handler);
    return () => {
      cancelled = true;
      window.removeEventListener('lp-actions-changed', handler);
    };
  }, [projectId, locale]);
  return subtitle;
}

interface EmptyStateStage {
  stage: { number: number; label: string };
  status: 'done' | 'active' | 'pending';
  passed: number;
  total: number;
  results: Array<{ check: { id: string; label: string }; result: { passed: boolean; gap?: string } }>;
}

function ChatEmptyState({
  locale,
  projectId,
  onPick,
}: {
  locale: 'en' | 'it';
  projectId: string;
  onPick: (s: string) => void;
}) {
  const [evals, setEvals] = useState<EmptyStateStage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { count: knowledgeCount } = useKnowledgeCount(projectId);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/stages`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        const inner = body?.data ?? body;
        setEvals(Array.isArray(inner?.evaluations) ? inner.evaluations : []);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  const active = evals.find((e) => e.status === 'active');
  const doneStages = evals.filter((e) => e.status === 'done');
  const openChecks = active ? active.results.filter((r) => !r.result.passed) : [];
  // "Has the founder already added substance?" — any validated stage, any passed
  // check in the active stage, or knowledge entities (e.g. from a doc upload).
  const hasProgress =
    doneStages.length > 0 ||
    (!!active && active.results.some((r) => r.result.passed)) ||
    knowledgeCount > 0;

  const btnStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '10px 12px',
    borderRadius: 'var(--r-m)',
    border: '1px solid var(--line-2)',
    background: 'var(--surface)',
    color: 'var(--ink-2)',
    fontSize: 12.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };

  // ── Briefing: the project already has extracted / validated state ──────────
  if (loaded && hasProgress) {
    const briefParts: string[] = [];
    if (doneStages.length > 0) briefParts.push(`${doneStages.length} stage${doneStages.length === 1 ? '' : 's'} validated`);
    if (active) briefParts.push(`${active.stage.label} in progress (${active.passed}/${active.total})`);
    if (knowledgeCount > 0) briefParts.push(`${knowledgeCount} knowledge entit${knowledgeCount === 1 ? 'y' : 'ies'}`);

    return (
      <div style={{ padding: '10px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 0, marginBottom: 4, lineHeight: 1.5, fontWeight: 500 }}>
          {locale === 'it' ? 'Ecco a che punto sei — ho letto quello che hai aggiunto:' : "Here's where your project stands — I've read what you've added:"}
        </p>
        {briefParts.length > 0 && (
          <p className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)', margin: '0 0 14px', lineHeight: 1.5 }}>
            {briefParts.join('  ·  ')}
          </p>
        )}
        {openChecks.length > 0 ? (
          <>
            <p style={{ fontSize: 11.5, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--f-mono)', margin: '0 0 8px' }}>
              {locale === 'it' ? 'Prossimi passi consigliati' : 'Recommended next steps'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {openChecks.slice(0, 4).map((c) => (
                <button key={c.check.id} onClick={() => onPick(checkActionPrompt(c.check.label))} style={btnStyle}>
                  <span style={{ fontWeight: 500, color: 'var(--ink)' }}>{c.check.label}</span>
                  {c.result.gap && (
                    <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-5)', marginTop: 2 }}>{c.result.gap}</span>
                  )}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--ink-4)' }}>
            {locale === 'it' ? 'Tutto validato in questa tappa — chiedimi di passare alla prossima.' : "This stage is fully validated — ask me to move to the next one."}
          </p>
        )}
      </div>
    );
  }

  // ── Fresh project (no substance yet): early-stage starter prompts ──────────
  const prompts = locale === 'it'
    ? ['Aiutami a strutturare la mia idea', 'Chi sono i miei competitor?', 'Cosa dovrei validare per primo?']
    : ['Help me structure my idea', 'Who are my competitors?', 'What should I validate first?'];

  return (
    <div style={{ padding: '10px 0' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        {locale === 'it'
          ? 'Chiedi al co-pilot qualsiasi cosa sul tuo progetto. Ho accesso a metriche, ecosystem alert, inbox e knowledge graph.'
          : 'Ask your co-pilot anything about your project. I have access to metrics, ecosystem alerts, inbox, and the knowledge graph.'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {prompts.map((p) => (
          <button key={p} onClick={() => onPick(p)} style={btnStyle}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

function Msg({
  messageId,
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
  onMouseEnter,
  onMouseLeave,
}: {
  messageId: string;
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
  /** Turn-linked canvas: hover handlers for message↔canvas linking */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const [toolsExpanded, setToolsExpanded] = useState(false);

  if (who === 'user') {
    return (
      <div
        className="lp-msg-row"
        data-message-id={messageId}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
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
    <div data-message-id={messageId} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 4,
            background: 'var(--sky)',
            color: 'var(--on-accent)',
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
        {streaming && <Pill kind="live" dot>streaming</Pill>}
      </div>
      {tools && tools.length === 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          <span
            className="lp-chip"
            style={{
              background: tools[0].status === 'running'
                ? 'var(--accent-wash)'
                : tools[0].status === 'error'
                  ? 'var(--accent-wash)'
                  : 'var(--paper-2)',
              color: tools[0].status === 'running'
                ? 'var(--accent-ink)'
                : tools[0].status === 'error'
                  ? 'var(--clay)'
                  : 'var(--ink-4)',
            }}
          >
            {tools[0].status === 'running' && (
              <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
            )}
            {tools[0].name}
          </span>
        </div>
      )}
      {tools && tools.length > 1 && !toolsExpanded && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <span
            className="lp-chip"
            style={{
              background: tools.some((t) => t.status === 'running') ? 'var(--accent-wash)' : 'var(--paper-2)',
              color: tools.some((t) => t.status === 'running') ? 'var(--accent-ink)' : 'var(--ink-4)',
              cursor: 'pointer',
            }}
            onClick={() => setToolsExpanded(true)}
          >
            {tools.some((t) => t.status === 'running') && (
              <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
            )}
            Using {tools.length} tools…
          </span>
        </div>
      )}
      {tools && tools.length > 1 && toolsExpanded && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {tools.map((t) => (
            <span
              key={t.id}
              className="lp-chip"
              style={{
                background: t.status === 'running'
                  ? 'var(--accent-wash)'
                  : t.status === 'error'
                    ? 'var(--accent-wash)'
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
          <span
            className="lp-chip"
            style={{ background: 'var(--paper-2)', color: 'var(--ink-4)', cursor: 'pointer' }}
            onClick={() => setToolsExpanded(false)}
          >
            collapse
          </span>
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
    // GFM pipe table — a header row immediately followed by a delimiter row
    // (|---|---|). Must run BEFORE the paragraph collector below, which would
    // otherwise join every row with spaces into the "| A | B | |---|---| | 1 |"
    // mush. Requiring a `|` in the delimiter row disambiguates it from a `---`
    // horizontal rule.
    const isDelimiterRow = (l: string) =>
      l.includes('|') && l.includes('-') &&
      /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(l);
    const looksLikeRow = (l: string) => l.includes('|') && l.trim() !== '';
    if (looksLikeRow(line) && i2 + 1 < lines.length && isDelimiterRow(lines[i2 + 1])) {
      const splitCells = (l: string) =>
        l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      const headers = splitCells(line);
      const startKey = i2;
      i2 += 2; // consume the header + delimiter rows
      const bodyRows: string[][] = [];
      while (i2 < lines.length && looksLikeRow(lines[i2]) && !isDelimiterRow(lines[i2])) {
        bodyRows.push(splitCells(lines[i2]));
        i2++;
      }
      nodes.push(
        <table key={`tbl${startKey}`}>
          <thead>
            <tr>
              {headers.map((h, ci) => <th key={ci}>{inline(h, `th${startKey}-${ci}`)}</th>)}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((cells, ri) => (
              <tr key={ri}>
                {/* index off headers so ragged rows stay column-aligned */}
                {headers.map((_, ci) => <td key={ci}>{inline(cells[ci] ?? '', `td${startKey}-${ri}-${ci}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>,
      );
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

  const prose = rawContent.replace(/:::artifact[\s\S]*?(?::::|$)/g, '').trim();

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
    const options = a.options as Array<{ id?: string; label?: string; description?: string; credits?: number }>;
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
          {options.map((o, i) => {
            // UI guardrail: the model sometimes emits paragraph-length labels.
            // Split essays into label (first clause) + description overflow,
            // then CSS-clamp: label = 1 line, description = 2 lines. The full
            // text stays reachable via the title attribute.
            //
            // The PAYLOAD carries the FULL original label (split.full), never
            // the clamped head: handleArtifactAction sends "I choose: <label>"
            // back to the agent, and a truncated "Yes" can't disambiguate
            // between similar options. Clamping is render-only.
            const split = splitOptionLabel(o.label || `Option ${i + 1}`, o.description);
            return (
              <button
                key={o.id || i}
                type="button"
                title={split.full}
                onClick={() =>
                  onAction?.('select-option', {
                    optionId: o.id ?? String(i),
                    label: split.full || `Option ${i + 1}`,
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
                  minWidth: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      flex: 1,
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {split.label || `Option ${i + 1}`}
                  </span>
                  {/* Per-option credit estimate — what this choice spends. */}
                  {typeof o.credits === 'number' && o.credits > 0 && (
                    <span
                      className="lp-mono"
                      style={{
                        flexShrink: 0,
                        fontSize: 10,
                        color: 'var(--ink-5)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ≈{o.credits} {o.credits === 1 ? 'credit' : 'credits'}
                    </span>
                  )}
                </div>
                {split.description && (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--ink-4)',
                      marginTop: 2,
                      lineHeight: 1.4,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {split.description}
                  </div>
                )}
              </button>
            );
          })}
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

  if (artifact.type === 'skill-suggestion') {
    return <SkillSuggestionCard artifact={artifact} onAction={onAction} />;
  }

  if (artifact.type === 'knowledge-suggestion') {
    return <KnowledgeSuggestionCard artifact={artifact} onAction={onAction} />;
  }

  if (artifact.type === 'task') {
    return <TaskCard artifact={artifact} onAction={onAction} />;
  }

  // validation-proposal — the in-chat approval gate for a batch of validation
  // evidence (founder directive 2026-06-12: nothing turns a spine substep green
  // without the founder's yes). Renders inline in the thread that produced it,
  // not the canvas — the founder reviews/edits/applies right where the agent
  // proposed it. onAction is always supplied by Msg; the ?? noop satisfies the
  // card's required prop without changing behaviour.
  if (artifact.type === 'validation-proposal') {
    return (
      <ValidationProposalCard
        artifact={artifact as ValidationProposalArtifact}
        onAction={onAction ?? (() => {})}
      />
    );
  }

  return null;
}

// ─── SkillSuggestionCard ──────────────────────────────────────────────────────
//
// EPHEMERAL inline skill proposal. Founder directive (2026-06-11): skills are
// proposed at conversation runtime; if ignored, nothing persists (this card is
// just part of the chat transcript — no pending_action, no DB row). Clicking Run
// fires the skill in real time via POST /skills?run=1 (skill_completions +
// section_scores) through handleArtifactAction's 'skill:run' verb. The credit
// cost is shown on the button BEFORE the click so the spend is consented; an
// inline running/done state appears AFTER.
function SkillSuggestionCard({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const a = artifact as unknown as Record<string, unknown>;
  const skillId = typeof a.skill_id === 'string' ? a.skill_id : '';
  const label = typeof a.skill_label === 'string' && a.skill_label ? a.skill_label : (skillId || 'Skill');
  const rationale = typeof a.rationale === 'string' ? a.rationale : '';
  const credits = typeof a.credits === 'number' ? a.credits : null;
  const context = typeof a.context === 'string' ? a.context : '';
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const run = async () => {
    if (state === 'running' || state === 'done' || !skillId) return;
    setState('running');
    setErrMsg('');
    try {
      await onAction?.('skill:run', { skill_id: skillId, context });
      setState('done');
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : 'Run failed');
    }
  };

  const btnLabel =
    state === 'running' ? 'Running…' :
    state === 'done' ? 'Done' :
    state === 'error' ? 'Retry' :
    credits != null ? `Run (≈${credits} credits)` : 'Run';

  // Inline, NOT a separate bordered section: the skill CTA flows within the
  // assistant's message (founder directive 2026-06-11 — "should not render as
  // a separate section"). A button-led row + muted rationale, no card chrome.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, margin: '2px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={run}
          disabled={state === 'running' || state === 'done'}
          style={{
            flexShrink: 0,
            padding: '5px 12px',
            borderRadius: 999,
            background: state === 'done' ? 'var(--paper-3)' : 'var(--ink)',
            color: state === 'done' ? 'var(--ink-3)' : 'var(--paper)',
            border: 'none',
            cursor: state === 'running' || state === 'done' ? 'default' : 'pointer',
            fontSize: 11.5,
            fontFamily: 'inherit',
            fontWeight: 500,
            opacity: state === 'running' ? 0.7 : 1,
          }}
        >
          {btnLabel}
        </button>
        <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>
          {label}
          {state === 'idle' && credits != null && (
            <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--ink-5)', fontWeight: 400 }}>
              ≈{credits} credits
            </span>
          )}
        </span>
      </div>
      {state === 'idle' && rationale && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>{rationale}</div>
      )}
      {state === 'running' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          Running in real time — this writes validation evidence when it finishes.
        </div>
      )}
      {state === 'done' && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          Skill ran — readiness and the spine have been updated.
        </div>
      )}
      {state === 'error' && errMsg && (
        <div style={{ fontSize: 11, color: 'var(--clay)' }}>{errMsg}</div>
      )}
    </div>
  );
}

// ─── KnowledgeSuggestionCard ──────────────────────────────────────────────────
//
// EPHEMERAL inline knowledge proposal. Founder directive (2026-06-11): when the
// agent states a fact/insight in PROSE (no card), it surfaces this CTA instead
// of silently writing memory. Clicking "Apply to intelligence · 2 credits"
// POSTs to /knowledge { apply: true } via handleArtifactAction's
// 'knowledge:apply-inline' verb — which persists the fact as applied AND debits
// 2 credits server-side. If ignored, nothing persists (transcript only).
function KnowledgeSuggestionCard({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const a = artifact as unknown as Record<string, unknown>;
  const fact = typeof a.fact === 'string' ? a.fact : '';
  const kind = typeof a.kind === 'string' ? a.kind : 'observation';
  const credits = typeof a.credits === 'number' ? a.credits : 2;
  const sources = Array.isArray(a.sources) ? a.sources : [];
  const [state, setState] = useState<'idle' | 'applying' | 'done' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState('');

  const apply = async () => {
    if (state === 'applying' || state === 'done' || !fact) return;
    setState('applying');
    setErrMsg('');
    try {
      await onAction?.('knowledge:apply-inline', { fact, kind, sources });
      setState('done');
    } catch (e) {
      setState('error');
      setErrMsg(e instanceof Error ? e.message : 'Apply failed');
    }
  };

  if (!fact) return null;

  const btnLabel =
    state === 'applying' ? 'Applying…' :
    state === 'done' ? 'Applied ✓' :
    state === 'error' ? 'Retry' :
    `Apply to intelligence · ${credits} credits`;

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
        <div style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.4 }}>{fact}</div>
        {state === 'done' && (
          <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
            Saved to project intelligence.
          </div>
        )}
        {state === 'error' && errMsg && (
          <div style={{ fontSize: 11, color: 'var(--clay)', marginTop: 4 }}>{errMsg}</div>
        )}
      </div>
      <button
        type="button"
        onClick={apply}
        disabled={state === 'applying' || state === 'done'}
        style={{
          flexShrink: 0,
          padding: '6px 11px',
          borderRadius: 'var(--r-m)',
          background: state === 'done' ? 'var(--paper-3)' : 'var(--moss)',
          color: state === 'done' ? 'var(--ink-3)' : 'var(--paper)',
          border: 'none',
          cursor: state === 'applying' || state === 'done' ? 'default' : 'pointer',
          fontSize: 11.5,
          fontFamily: 'inherit',
          fontWeight: 500,
          opacity: state === 'applying' ? 0.7 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {btnLabel}
      </button>
    </div>
  );
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────
//
// Inline founder-task card: priority pill, title (.lp-serif), optional
// description (.lp-md), three actions — Mark done / Snooze / Dismiss.
// Resolves to /api/projects/[projectId]/tasks/[clientArtifactId] via
// handleArtifactAction.
const TASK_PRIORITY_STYLES: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: 'var(--clay)',     fg: 'var(--on-accent)', label: 'Critical' },
  high:     { bg: 'var(--accent)',   fg: 'var(--ink)',       label: 'High' },
  medium:   { bg: 'var(--sky)',      fg: 'var(--on-accent)', label: 'Medium' },
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
  onInsertTemplate,
  onAttachText,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  locale: 'en' | 'it';
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
          <span style={{ flex: 1 }} />
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
                background: 'var(--line)',
                borderColor: 'var(--line-2)',
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
 * Two sections:
 *   - Templates — quick-insert prompts into the textarea.
 *   - Attach    — opens a file picker (text-like files only, ≤200KB).
 *
 * Closes on outside click and Escape.
 */
function ComposerMenu({
  locale,
  templates,
  onClose,
  onInsertTemplate,
  onAttach,
}: {
  locale: 'en' | 'it';
  templates: { label: string; text: string }[];
  onClose: () => void;
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
// Strip artifact blocks from message text so the chat column shows only prose
// =============================================================================

function stripArtifacts(content: string): string {
  return content.replace(/:::artifact[\s\S]*?(?::::|$)/g, '').trim();
}
