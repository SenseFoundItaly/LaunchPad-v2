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

import { use, useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/api';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { useChat, chatStoreHydrated, markChatHydrated } from '@/hooks/useChat';
import { useStages } from '@/hooks/useStages';
import { requestRecharge } from '@/components/credits/recharge-events';
import { useProject } from '@/hooks/useProject';
import { splitOptionLabel } from '@/components/chat/option-label';
import { IdeaShapingQuickReplies } from '@/components/chat/IdeaShapingQuickReplies';
import { parseMessageContent } from '@/lib/artifact-parser';
import { KNOWLEDGE_APPLY_CREDITS } from '@/lib/credit-costs';
import type { Artifact, ArtifactType, Department, ValidationProposalArtifact } from '@/types/artifacts';
import ValidationProposalCard from '@/components/chat/artifacts/ValidationProposalCard';
import MonitorProposalCard from '@/components/chat/artifacts/MonitorProposalCard';
import { Canvas, type PendingPlaceholder } from '@/components/canvas/Canvas';
import AddDocumentsDialog from '@/components/knowledge/AddDocumentsDialog';
import { TopBar, NavRail } from '@/components/design/chrome';
// CreditsBadge is now mounted globally inside TopBar (see chrome.tsx) so we
// don't import or insert it here. The `right` slot below only carries the
// chat-specific controls (model picker, context export).
import { useSetChrome } from '@/components/design/chrome-context';
import { useKnowledgeCount } from '@/hooks/useKnowledgeCount';
import { checkActionPrompt } from '@/lib/journey-prompts';
import { buildContextMarkdown } from '@/lib/context-export';
import { buildFinancialExport } from '@/lib/financial-export';
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

// Artifact types that must NEVER render as Canvas department cards even though
// they aren't in INLINE/PINNED above. The Canvas split is a blocklist (anything
// not inline/pinned → Canvas), so an artifact type the frontend doesn't know how
// to render (e.g. the agent sometimes emits `watch-source-proposal`, which isn't
// even in the ArtifactType union) would otherwise fall through, get the default
// 'market' department, and render as an EMPTY card ("Mercato · 2" with blank
// boxes — founder report). These are handled elsewhere (watcher proposals live
// in the Watchers tab + the monitor-proposal inline backstop), so drop them from
// the Canvas entirely. Typed as string because some values aren't valid
// ArtifactTypes by design. */
const NON_CANVAS_TYPES = new Set<string>(['watch-source-proposal']);

/**
 * Skills the project can't run YET (idea canvas missing solution/value_prop),
 * shared with every InlineOption so a skill option — whether freshly proposed,
 * left over in old history, or hallucinated by the model — renders as LOCKED
 * instead of a live "Run" button. The server gate (proposal-time tool-strip +
 * run-time 422) is the authority; this is the visible client mirror of it.
 * Empty set = everything runnable (the safe default if the fetch fails).
 */
const GatedSkillsContext = createContext<Set<string>>(new Set());

/**
 * Option-set selection memory. Once the founder picks an option (which starts a
 * response), that option-set must LOCK: every option becomes non-clickable but
 * stays visible ("saved"), with the chosen one marked. Lifted to the page so a
 * selection survives re-renders; keyed by a per-message-unique set id. The
 * `streaming` flag locks ALL sets while a response is in flight, so previous
 * suggestions can't be clicked mid-answer.
 */
interface OptionSelectionState {
  selectedBySet: Record<string, string>; // unique setId -> chosen option id
  markSelected: (setId: string, optionId: string) => void;
  unmarkSelected: (setId: string) => void; // revert an optimistic lock when its commit failed
  streaming: boolean;
}
const OptionSelectionContext = createContext<OptionSelectionState>({
  selectedBySet: {},
  markSelected: () => {},
  unmarkSelected: () => {},
  streaming: false,
});

/** Fetch the project's currently-un-runnable skills and keep them fresh —
 *  refetch when the canvas changes (lp-actions-changed fires on validation
 *  applies), so skills UNLOCK the moment a solution + value prop land. */
function useGatedSkills(projectId: string): Set<string> {
  // Cached via TanStack under the 'skills' topic so it survives tab navigation.
  // The lp-actions-changed bridge invalidates 'skills', so the set still
  // refreshes the moment a validation apply unlocks a skill — no per-component
  // listener and no cache:'no-store' (which forced a fetch on every mount).
  const { data } = useQuery<string[]>({
    queryKey: ['skills', projectId, 'gated'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/skills?availability=1`);
      const body = await res.json();
      return Array.isArray(body?.data?.gated) ? body.data.gated : [];
    },
  });
  return useMemo(() => new Set(data ?? []), [data]);
}

function classifyArtifacts(content: string): { inline: Artifact[]; canvas: Artifact[] } {
  const segments = parseMessageContent(content);
  const all = segments
    .filter((s) => s.type === 'artifact')
    .map((s) => (s as { type: 'artifact'; artifact: Artifact }).artifact);
  return {
    inline: all.filter((a) => INLINE_ARTIFACT_TYPES.has(a.type)),
    canvas: all.filter(
      (a) =>
        !INLINE_ARTIFACT_TYPES.has(a.type) &&
        !PINNED_ARTIFACT_TYPES.has(a.type) &&
        !NON_CANVAS_TYPES.has(a.type as string),
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
  const t = useT();
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
    openPrintPreview(`${project?.name || t('chat.context-export-title')}`, md);
  }

  // Financial model (item 13): export the detailed projections as editable CSV
  // (or JSON fallback). No-op if the financial-model skill hasn't run yet.
  async function handleDownloadFinancial() {
    setOpen(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/financial-model`);
      const body = await res.json().catch(() => null);
      const model = body?.data?.financial_model ?? body?.financial_model ?? null;
      const payload = buildFinancialExport(model);
      if (!payload) return; // nothing to export yet
      const blob = new Blob([payload.text], { type: payload.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(project?.name || 'export').replace(/\s+/g, '-').toLowerCase()}-${payload.filename}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* non-fatal — surfaced as no download */
    }
  }

  // GO/NO-GO report (item 11): the lean decision doc — scoring, per-stage
  // results, signals, risks, open tasks. No chat history / raw dumps.
  async function handleDownloadGoNoGo() {
    setOpen(false);
    const data = await gatherData();
    const md = buildContextMarkdown(data, { goNoGo: true });
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(project?.name || 'export').replace(/\s+/g, '-').toLowerCase()}-go-no-go-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <IconBtn
        d={I.download}
        title={t('chat.export-context')}
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
            {t('chat.download-md')}
          </button>
          <button
            type="button"
            onClick={handleDownloadGoNoGo}
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
            <Icon d={I.check} size={14} stroke={1.4} />
            {t('chat.download-gonogo')}
          </button>
          <button
            type="button"
            onClick={handleDownloadFinancial}
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
            <Icon d={I.dollar} size={14} stroke={1.4} />
            {t('chat.download-financial')}
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
            {t('chat.print-pdf')}
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
  const t = useT();
  const { project } = useProject(projectId);
  // Skills the project can't run yet — provided to every InlineOption so locked
  // skills never render as live Run buttons (mirrors the server prereq gate).
  const gatedSkills = useGatedSkills(projectId);
  // One project = one chat. The chat_messages.step column is fixed to 'chat'
  // (multi-thread routing was removed — see commit history).
  const step = 'chat';
  const { messages, isStreaming, sendMessage: sendMessageRaw, setMessages } = useChat(projectId, step);
  const [input, setInput] = useState('');
  // Option-set selection memory (see OptionSelectionContext): which option the
  // founder picked per set, so a chosen set locks — saved, not clickable. First
  // pick wins (later clicks on the same set are ignored).
  const [selectedBySet, setSelectedBySet] = useState<Record<string, string>>({});
  const markOptionSelected = useCallback((setId: string, optionId: string) => {
    if (!setId) return;
    setSelectedBySet((prev) => (prev[setId] !== undefined ? prev : { ...prev, [setId]: optionId }));
  }, []);
  // Revert an optimistic lock: a commit option locks the set on click, but if the
  // write fails we must un-lock so the founder can retry (and never leave a false ✓).
  const unmarkOptionSelected = useCallback((setId: string) => {
    if (!setId) return;
    setSelectedBySet((prev) => {
      if (prev[setId] === undefined) return prev;
      const next = { ...prev };
      delete next[setId];
      return next;
    });
  }, []);
  const optionSelection = useMemo<OptionSelectionState>(
    () => ({ selectedBySet, markSelected: markOptionSelected, unmarkSelected: unmarkOptionSelected, streaming: isStreaming }),
    [selectedBySet, markOptionSelected, unmarkOptionSelected, isStreaming],
  );

  // Cross-page pre-fill: CTAs on the Today page (StageCard checks + the
  // Next-to-validate list) link here as /chat?prefill=<prompt> to start the
  // founder on a specific validation substep. Load it into the composer ONCE on
  // mount — no auto-send (same review/edit/send contract as the in-canvas
  // substep click) — then strip the param so a refresh doesn't re-fill. Reading
  // window.location.search (not useSearchParams) keeps this client-only and
  // avoids a Suspense boundary; the Today→chat hop always remounts this page.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get('prefill');
    if (!prefill) return;
    setInput(prefill);
    // Defer focus until the composer textarea has mounted this frame.
    requestAnimationFrame(() => {
      const tas = Array.from(document.querySelectorAll('textarea')) as HTMLTextAreaElement[];
      const composer = tas.find((ta) => /co-pilot/i.test(ta.placeholder)) ?? tas[0];
      composer?.focus();
      composer?.scrollIntoView({ block: 'nearest' });
    });
    params.delete('prefill');
    const qs = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);
  // Init true when the store already holds this thread (tab-return) so we don't
  // flash "Loading history…" or re-fetch. Fresh mount / full refresh → false.
  const [historyLoaded, setHistoryLoaded] = useState(() => chatStoreHydrated(projectId, step));
  const scrollRef = useRef<HTMLDivElement>(null);
  // Turn-linked canvas: which chat message is hovered (null = none).
  const [focusedMessageId, setFocusedMessageId] = useState<string | null>(null);
  // "Audit document → knowledge" popup, opened from the composer "+" menu. Runs
  // the same priced extract→apply pipeline as the Knowledge page (a flat per-
  // document audit fee, then free apply) — so a doc dropped in chat reaches the
  // knowledge graph the same way a project-start doc does.
  const [showAddDocs, setShowAddDocs] = useState(false);

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
        // Mark hydrated ONLY on a SUCCESSFUL load (or when a stream already
        // populated the thread, handled by the early returns above + the
        // mount-time guard). A failed/transient load must stay un-hydrated so the
        // next mount/refresh REBUILDS it — otherwise a one-off failure
        // (cold-compile 500, timeout, server restart) would leave the thread
        // permanently empty ("messages lost after refresh") until another refresh.
        markChatHydrated(projectId, step);
        setHistoryLoaded(true);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        console.warn('[chat] history fetch failed (stays reloadable):', (err as Error).message);
        // Do NOT markChatHydrated and do NOT clobber messages to [] — leaving the
        // thread un-hydrated lets the next mount/refresh retry the load instead of
        // presenting a permanently-empty "done" thread. Just clear the spinner.
        setHistoryLoaded(true);
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
  const { canvasEntries, canvasArtifacts, inlineArtifactsByMsgId, pendingPlaceholders } = useMemo(() => {
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

    // Item 9 — progressive Canvas paint. While the latest assistant message is
    // still streaming, surface in-flight artifact blocks (the `:::artifact{…}`
    // header has streamed but the body/closing hasn't) as dimmed skeletons so
    // the Canvas fills incrementally instead of all-at-once on `done`. Scoped to
    // the streaming message only — historical malformed blocks never skeleton.
    // Ids already materialized as full cards are skipped (they win).
    const placeholders: PendingPlaceholder[] = [];
    if (isStreaming) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant' && last.content) {
        for (const seg of parseMessageContent(last.content)) {
          if (seg.type !== 'artifact-pending' || !seg.header) continue;
          const { type, id, department } = seg.header;
          if (!type || !id || canvasById.has(id)) continue;
          const at = type as ArtifactType;
          // Same canvas/inline split as classifyArtifacts — only paint blocks
          // that would land in the right-side Canvas (not inline/pinned bubbles).
          if (
            INLINE_ARTIFACT_TYPES.has(at) ||
            PINNED_ARTIFACT_TYPES.has(at) ||
            NON_CANVAS_TYPES.has(type) ||
            type === 'solve-progress'
          ) continue;
          placeholders.push({
            id,
            type,
            department: (department as Department | undefined) ?? 'market',
          });
        }
      }
    }

    return {
      canvasEntries: entries,
      canvasArtifacts: entries.map((e) => e.artifact),
      inlineArtifactsByMsgId: inlineMap,
      pendingPlaceholders: placeholders,
    };
  }, [messages, isStreaming]);

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
      // card carries Apply · 0.5 credits / Dismiss. PATCHes the unified knowledge
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
      // debits the 0.5 credits server-side. Broadcasts the same refetch events.
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
          // Hard-stop: out of credits → open the recharge modal and stop
          // gracefully (the 402 is a clean JSON body returned before the
          // keepalive stream opens). Don't throw — that would error the card.
          if (res.status === 402) {
            const body = await res.json().catch(() => null);
            if (body?.error === 'out_of_credits') {
              requestRecharge({ remaining: body.credits_remaining ?? 0 });
              return;
            }
          }
          // Prerequisite gate: the idea canvas is too empty for this skill to
          // produce anything usable. The server blocked it BEFORE spending, so
          // surface its guidance as an assistant message (no charge, no error
          // card) rather than letting the founder watch it fail.
          if (res.status === 422) {
            const body = await res.json().catch(() => null);
            if (body?.error === 'missing_prerequisites' && body?.message) {
              setMessages((prev) => [
                ...prev,
                {
                  id: `msg_${Date.now()}`,
                  role: 'assistant',
                  content: body.message as string,
                  timestamp: new Date().toISOString(),
                },
              ]);
              return;
            }
          }
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
          throw new Error(err.error || `Analysis run failed with status ${res.status}`);
        }
        // Inject the skill output back into the conversation. The skill ran in a
        // SEPARATE request (runSkill) that touched the DB but NOT the `messages`
        // array — so without this the founder saw the button flip to "done" and
        // nothing else, and the chat Canvas (derived from `messages`) stayed
        // empty even when the skill emitted :::artifact blocks. Appending an
        // assistant message both (a) shows the result in the thread and (b) lets
        // canvasArtifacts pick up the artifacts the skill produced.
        // The skill run STREAMS (keepalive heartbeats while runSkill executes,
        // then one final result event) so it outlives the serverless gateway
        // timeout — a buffered response would 504 on long skills (idea-shaping).
        // Consume the SSE: skip ': keepalive' comment lines, parse the final
        // `data:` event for {status, summary, error}.
        let runData: { status?: string; summary?: string; error?: string } | null = null;
        // Live streaming: the skill output now arrives as {delta} events (the
        // /skills SSE route forwards runAgent's text deltas). Render them into a
        // single GROWING assistant message so the founder watches the skill being
        // written — not a frozen "Running…". The final {done,...} event carries
        // the authoritative full text + status.
        const liveId = `msg_skill_${Date.now()}`;
        let streamed = '';
        let liveStarted = false;
        let lastFlush = 0;
        const flushLive = () => {
          const now = Date.now();
          if (now - lastFlush < 120) return; // throttle re-renders during a long stream
          lastFlush = now;
          setMessages((prev) =>
            prev.some((m) => m.id === liveId)
              ? prev.map((m) => (m.id === liveId ? { ...m, content: streamed } : m))
              : [...prev, { id: liveId, role: 'assistant', content: streamed, timestamp: new Date().toISOString() }],
          );
        };
        const reader = res.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          let buf = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              let obj: { delta?: string; status?: string; summary?: string; error?: string } | null = null;
              try { obj = JSON.parse(line.slice(6)); } catch { continue; /* partial/non-JSON */ }
              if (obj && typeof obj.delta === 'string') {
                streamed += obj.delta;
                liveStarted = true;
                flushLive();
              } else if (obj) {
                runData = obj; // done / error event
              }
            }
          }
        }
        if (runData?.error) throw new Error(runData.error);
        const runStatus = runData?.status;
        const runSummary = typeof runData?.summary === 'string' ? runData.summary : '';
        // Authoritative final content: the incomplete-note on a quality-gate fail,
        // else the full summary (replaces any partial streamed text — e.g. a
        // mid-stream artifact block — with the clean, complete final).
        const finalContent = (runStatus === 'incomplete' || !runSummary.trim())
          ? t('chat.skill-incomplete-note')
          : runSummary;
        if (liveStarted) {
          setMessages((prev) => prev.map((m) => (m.id === liveId ? { ...m, content: finalContent } : m)));
        } else {
          // No deltas streamed (instant skill / older transport) — append as before.
          setMessages((prev) => [
            ...prev,
            { id: `msg_${Date.now()}`, role: 'assistant', content: finalContent, timestamp: new Date().toISOString() },
          ]);
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
      if (action === 'commit:apply') {
        // Deterministic commit: a clicked "Confirm — commit" option IS the
        // founder's approval, so PERSIST the evidence here instead of letting the
        // model narrate a commit it skips. Two channels, applied in order:
        //   - canvas text  → POST /idea-canvas (free, idempotent COALESCE upsert)
        //   - paid/items   → POST /validation/commit (create+apply a
        //                    validation_proposal → graph_nodes/memory_facts +
        //                    credit debit, reusing applyValidationProposal)
        // Then forward a normal turn so the agent continues; the evidence is
        // already written, so any "committed" it then says is TRUE.
        const CANVAS_FIELD_KEYS = ['problem', 'solution', 'target_market', 'value_proposition', 'business_model', 'competitive_advantage'];
        const raw = (payload.canvas && typeof payload.canvas === 'object') ? payload.canvas as Record<string, unknown> : {};
        const fields: Record<string, string> = {};
        for (const k of CANVAS_FIELD_KEYS) {
          const v = raw[k];
          if (typeof v === 'string' && v.trim()) fields[k] = v.trim();
        }
        if (Object.keys(fields).length > 0) {
          const res = await fetch(`/api/projects/${projectId}/idea-canvas`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `Canvas commit failed with status ${res.status}`);
          }
        }
        const items = Array.isArray(payload.items) ? payload.items : [];
        if (items.length > 0) {
          const res = await fetch(`/api/projects/${projectId}/validation/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
            throw new Error(err.error || `Commit failed with status ${res.status}`);
          }
        }
        if (typeof window !== 'undefined' && (Object.keys(fields).length > 0 || items.length > 0)) {
          // Canvas header + spine read idea_canvas/graph and reload on
          // lp-actions-changed; knowledge count / Stage progress / credits listen
          // on lp-knowledge-changed / lp-credits-changed. Fire all so the commit
          // (and any credit debit from paid items) shows immediately.
          window.dispatchEvent(new CustomEvent('lp-actions-changed', { detail: { projectId } }));
          window.dispatchEvent(new CustomEvent('lp-knowledge-changed', { detail: { projectId } }));
          if (items.length > 0) window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
        }
        // Continue the conversation so the agent moves to the next gap.
        const cLabel = typeof payload.label === 'string' ? payload.label : 'Confirm';
        const cDesc = typeof payload.description === 'string' ? payload.description.trim() : '';
        sendMessage(`I choose: ${cLabel}${cDesc ? ` — ${cDesc}` : ''}`);
        return;
      }
      if (action === 'select-option' && typeof payload.label === 'string') {
        // Forward the option's DESCRIPTION (its stated intent/action) alongside
        // the label so the agent EXECUTES that option rather than re-reasoning a
        // bare label. Without it, "Use Example A — Legal radar" lost its
        // "commit this as your solution" intent and got misread as a watcher.
        const optDesc = typeof payload.description === 'string' ? payload.description.trim() : '';
        sendMessage(`I choose: ${payload.label}${optDesc ? ` — ${optDesc}` : ''}`);
      } else if (action === 'trigger-action' && typeof payload.title === 'string') {
        const desc = typeof payload.description === 'string' ? payload.description : '';
        sendMessage(`${payload.title}${desc ? ': ' + desc : ''}. Give me a detailed step-by-step plan.`);
      }
    },
    [projectId, sendMessage, setMessages, t],
  );

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  useSetChrome(
    {
      breadcrumb: [project?.name || '', t('chat.breadcrumb-copilot')],
      right: (
        <>
          {(project as { access_kind?: string } | null)?.access_kind === 'member' && (
            <span
              className="lp-mono"
              title={
                (project as { owner_email?: string | null } | null)?.owner_email
                  ? t('chat.shared-by', { email: (project as { owner_email: string }).owner_email })
                  : t('chat.shared-with-you')
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
              {t('chat.shared')}{(project as { owner_email?: string | null } | null)?.owner_email
                ? ` · ${(project as { owner_email: string }).owner_email}`
                : ''}
            </span>
          )}
          {isStreaming && <Pill kind="live" dot>{t('chat.streaming')}</Pill>}
          <ContextExportBtn
            projectId={projectId}
            project={project}
            messages={messages}
            artifacts={canvasArtifacts}
            disabled={isStreaming}
          />
        </>
      ),
      status: { heartbeatLabel: isStreaming ? t('chat.status-streaming') : t('chat.status-idle') },
      chatStreaming: isStreaming,
    },
    [project, isStreaming, messages, canvasArtifacts],
  );

  return (
    <GatedSkillsContext.Provider value={gatedSkills}>
     <OptionSelectionContext.Provider value={optionSelection}>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
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
          <ChatHeader project={project} projectId={projectId} />

          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div
              ref={scrollRef}
              className="lp-scroll"
              onScroll={handleScroll}
              style={{ flex: 1, overflow: 'auto', padding: '16px 20px 20px' }}
            >
              {!historyLoaded && messages.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: 20, textAlign: 'center' }}>
                  {t('chat.loading-history')}
                </div>
              ) : messages.length === 0 ? (
                <ChatEmptyState
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
                      {t('chat.show-earlier', { count: hiddenCount })}
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
                title={t('chat.jump-to-latest-title')}
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
                {t('chat.jump-to-latest')}
              </button>
            )}
          </div>

          {/* Stable default replies during idea shaping — keep the founder
              moving without the restart-prone "Avvia Idea Shaping" kickoff
              (now a Canvas button). Self-hides once the canvas is filled. */}
          <IdeaShapingQuickReplies
            projectId={projectId}
            onReply={!isStreaming ? sendMessage : undefined}
          />

          <ChatComposer
            value={input}
            onChange={setInput}
            onSend={handleSend}
            onKeyDown={handleKey}
            disabled={isStreaming}
            onInsertTemplate={(text) => setInput((prev) => prev ? `${prev}\n${text}` : text)}
            onAttachText={(name, body) =>
              setInput((prev) => {
                const block = `Here is \`${name}\`:\n\n\`\`\`\n${body}\n\`\`\`\n`;
                return prev ? `${prev}\n${block}` : block;
              })
            }
            onAuditDocs={() => setShowAddDocs(true)}
          />
        </div>

        {/* Canvas */}
        <div
          data-tour="chat-canvas"
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
            pendingPlaceholders={pendingPlaceholders}
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

      {showAddDocs && (
        <AddDocumentsDialog
          projectId={projectId}
          onClose={() => setShowAddDocs(false)}
          onApplied={(_applied, creditsDebited) => {
            // Same event contract the chat page uses elsewhere ({ detail }), so
            // the Knowledge graph / credits badge refresh without a reload.
            window.dispatchEvent(new CustomEvent('lp-knowledge-changed', { detail: { projectId } }));
            if (creditsDebited > 0) {
              window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
            }
          }}
        />
      )}

     </OptionSelectionContext.Provider>
    </GatedSkillsContext.Provider>
  );
}

// =============================================================================
// Chat header + empty + composer + message
// =============================================================================

function ChatHeader({
  project,
  projectId,
}: {
  project: unknown;
  projectId: string;
}) {
  const p = project as { name?: string; description?: string } | null;
  const subtitle = useCurrentSubtask(projectId);
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
function useCurrentSubtask(projectId: string): string | null {
  const t = useT();
  // Shares the cached ['stages', projectId] query with SpineSection (one fetch
  // serves both) and refreshes via the lp-actions-changed bridge — no separate
  // per-mount fetch or window listener.
  const { data: evals } = useStages(projectId);
  return useMemo(() => {
    if (!evals) return null; // loading — show no stale placeholder
    const active = evals.find((e) => e.status === 'active');
    if (!active) {
      // No active stage: either nothing started or everything's validated.
      const allDone = evals.length > 0 && evals.every((e) => e.status === 'done');
      return allDone ? t('chat.subtask-all-validated') : null;
    }
    const openCheck = active.results.find((r) => !r.result.passed);
    return openCheck
      ? t('chat.subtask-validating', { label: openCheck.check.label })
      // Active stage with every substep passed — about to advance.
      : t('chat.subtask-ready-to-advance', { label: active.stage.label });
  }, [evals, t]);
}

interface EmptyStateStage {
  stage: { number: number; label: string };
  status: 'done' | 'active' | 'pending';
  passed: number;
  total: number;
  results: Array<{ check: { id: string; label: string }; result: { passed: boolean; gap?: string } }>;
}

function ChatEmptyState({
  projectId,
  onPick,
}: {
  projectId: string;
  onPick: (s: string) => void;
}) {
  const t = useT();
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
    if (doneStages.length > 0) {
      briefParts.push(
        doneStages.length === 1
          ? t('chat.brief-stages-validated-one', { count: doneStages.length })
          : t('chat.brief-stages-validated-other', { count: doneStages.length }),
      );
    }
    if (active) briefParts.push(t('chat.brief-stage-in-progress', { label: active.stage.label, passed: active.passed, total: active.total }));
    if (knowledgeCount > 0) {
      briefParts.push(
        knowledgeCount === 1
          ? t('chat.brief-knowledge-entities-one', { count: knowledgeCount })
          : t('chat.brief-knowledge-entities-other', { count: knowledgeCount }),
      );
    }

    return (
      <div style={{ padding: '10px 0' }}>
        <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 0, marginBottom: 4, lineHeight: 1.5, fontWeight: 500 }}>
          {t('chat.empty-briefing-intro')}
        </p>
        {briefParts.length > 0 && (
          <p className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)', margin: '0 0 14px', lineHeight: 1.5 }}>
            {briefParts.join('  ·  ')}
          </p>
        )}
        {openChecks.length > 0 ? (
          <>
            <p style={{ fontSize: 11.5, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'var(--f-mono)', margin: '0 0 8px' }}>
              {t('chat.recommended-next-steps')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {openChecks.slice(0, 4).map((c) => (
                <button key={c.check.id} onClick={() => onPick(checkActionPrompt(c.check.label, t))} style={btnStyle}>
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
            {t('chat.stage-fully-validated')}
          </p>
        )}
      </div>
    );
  }

  // ── Fresh project (no substance yet): early-stage starter prompts ──────────
  const prompts = [
    t('chat.starter-structure-idea'),
    t('chat.starter-competitors'),
    t('chat.starter-validate-first'),
  ];

  return (
    <div style={{ padding: '10px 0' }}>
      <p style={{ fontSize: 13, color: 'var(--ink-4)', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        {t('chat.empty-fresh-intro')}
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
  const t = useT();
  const [toolsExpanded, setToolsExpanded] = useState(false);

  if (who === 'user') {
    return (
      <div
        className="lp-msg-row lp-rise"
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
    <div className="lp-rise" data-message-id={messageId} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{ marginBottom: 18 }}>
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
        {streaming && <Pill kind="live" dot>{t('chat.streaming')}</Pill>}
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
            {tools.some((tool) => tool.status === 'running') && (
              <span className="lp-dot lp-pulse" style={{ background: 'var(--accent)' }} />
            )}
            {t('chat.using-tools', { count: tools.length })}
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
            {t('chat.tools-collapse')}
          </span>
        </div>
      )}
      <div
        className="lp-msg-row lp-md"
        style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)' }}
      >
        <MdProse text={String(children ?? '')} />
        {streaming && <span className="lp-caret" aria-hidden="true">▋</span>}
      </div>
      {inlineArtifacts && inlineArtifacts.length > 0 && (() => {
        // When actionable watcher cards are present, suppress the generic
        // suggestions option-set — the cards ARE the next action, so the extra
        // "what's next?" list below them just reads as clutter (founder feedback).
        // The backstop renders BOTH topic and URL watchers as monitor-proposal
        // cards, so that single type covers every watcher card.
        const hasWatcherCard = inlineArtifacts.some((a) => a.type === 'monitor-proposal');
        const shown = hasWatcherCard
          ? inlineArtifacts.filter((a) => a.type !== 'option-set')
          : inlineArtifacts;
        return (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((a, i) => (
              <div key={i} className="lp-rise"><InlineArtifact artifact={a} setId={`${messageId}:${i}`} onAction={onArtifactAction} /></div>
            ))}
          </div>
        );
      })()}
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
  const t = useT();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !onReply) return null;

  const prose = rawContent.replace(/:::artifact[\s\S]*?(?::::|$)/g, '').trim();

  // Extract the last question sentence to generate context-aware chips.
  const lastQuestion = prose.split(/(?<=[.!?])\s+/).filter(s => s.trim().endsWith('?')).pop()?.trim() ?? '';
  const hasQuestion = lastQuestion.length > 0;

  const chips = hasQuestion
    ? [
      t('chat.quick-reply-examples'),
      t('chat.quick-reply-step-by-step'),
      t('chat.quick-reply-move-on'),
    ]
    : [
      t('chat.quick-reply-prioritize'),
      t('chat.quick-reply-risks'),
      t('chat.quick-reply-next-step'),
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
/**
 * One inline option-set button. Two behaviours, one rendering:
 *   - skill option (`skill_id` set): clicking RUNS the skill in real time via
 *     the existing `skill:run` streaming path. The button manages its own
 *     running/done/error state. This folds the skill proposal INTO the
 *     suggestion option-set — no separate skill-suggestion "Run" card layered
 *     with a redundant duplicate option.
 *   - normal option: clicking sends "I choose: <label> — <description>" back to
 *     the agent (select-option). Forwards the DESCRIPTION (the option's stated
 *     intent) so the agent executes it rather than re-reasoning a bare label.
 */
function InlineOption({
  option,
  index,
  setLocked = false,
  chosen = false,
  dimmed = false,
  onChoose,
  onUnchoose,
  onAction,
}: {
  option: { id?: string; label?: string; description?: string; credits?: number; skill_id?: string; commit?: { canvas?: Record<string, string>; items?: Array<Record<string, unknown>> } };
  index: number;
  /** The whole option-set is locked (a choice was made, or a response is streaming). */
  setLocked?: boolean;
  /** This is the option the founder picked — keep it highlighted + marked. */
  chosen?: boolean;
  /** A sibling was picked — dim this un-chosen option. */
  dimmed?: boolean;
  /** Record this option as the set's selection (called on click, before dispatch). */
  onChoose?: () => void;
  /** Revert the selection lock — called when a commit option's write fails. */
  onUnchoose?: () => void;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const t = useT();
  const isSkill = typeof option.skill_id === 'string' && option.skill_id.length > 0;
  // Locked = a skill option whose prerequisites aren't met (idea canvas missing
  // solution/value_prop). Covers freshly-proposed, stale-history, AND
  // model-hallucinated skill_ids — they all render non-runnable here, so the
  // founder is never offered a "Run" they can't actually do.
  const gatedSkills = useContext(GatedSkillsContext);
  const locked = isSkill && !!option.skill_id && gatedSkills.has(option.skill_id);
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  // UI guardrail: the model sometimes emits paragraph-length labels. Split
  // essays into label (first clause) + description overflow, then CSS-clamp:
  // label = 1 line, description = 2 lines. The full text stays reachable via
  // the title attribute. The PAYLOAD carries the FULL original label
  // (split.full), never the clamped head — a truncated "Yes" can't
  // disambiguate between similar options. Clamping is render-only.
  const split = splitOptionLabel(option.label || `Option ${index + 1}`, option.description);

  const baseLabel = split.label || t('chat.option-fallback', { n: index + 1 });
  const labelText =
    locked ? `🔒 ${baseLabel}` :
    state === 'running' ? `${baseLabel} · ${t('chat.running')}` :
    state === 'done' ? `${baseLabel} · ${t('common.done')}` :
    state === 'error' ? `${baseLabel} · ${t('chat.commit-failed')}` :
    chosen ? `${baseLabel} · ✓` :
    baseLabel;
  // Disabled covers: locked skills (prereqs unmet), a skill mid/post-run, AND a
  // set-level lock — once any option here is chosen (or a response is streaming)
  // the whole set is non-clickable but stays visible ("saved").
  const isDisabled = locked || setLocked || (isSkill && (state === 'running' || state === 'done'));

  const handleClick = async () => {
    // Locked skill: prerequisites unmet — don't run, don't charge. The label
    // already tells the founder to sketch their solution first.
    if (locked) return;
    // Set already resolved (a choice was made, or a response is in flight): the
    // options are saved-but-frozen, so a stray click is a no-op.
    if (setLocked) return;
    if (isSkill) {
      // Skill option: run the skill in real time. Don't re-run once running/done.
      if (state === 'running' || state === 'done') return;
      onChoose?.(); // lock the set immediately so siblings can't also be clicked
      setState('running');
      try {
        await onAction?.('skill:run', { skill_id: option.skill_id });
        setState('done');
      } catch {
        setState('error');
      }
      return;
    }
    // Structured commit: this option carries the evidence (canvas fields and/or
    // paid items), so the click PERSISTS it deterministically (the click IS the
    // founder's approval) rather than round-tripping text the model could
    // narrate-but-not-perform.
    const commit = option.commit;
    const hasCanvas = !!commit?.canvas && Object.keys(commit.canvas).length > 0;
    const hasItems = Array.isArray(commit?.items) && commit.items.length > 0;
    if (commit && (hasCanvas || hasItems)) {
      onChoose?.(); // optimistic lock: blocks siblings + a re-click while the commit is in flight
      setState('running');
      try {
        // AWAIT the write. The handler throws on a non-ok /idea-canvas or
        // /validation/commit response; if we fire-and-forget, a failed write
        // would leave a false ✓ with nothing persisted (the exact narrate-but-
        // no-persist trap the deterministic commit exists to prevent).
        await onAction?.('commit:apply', {
          canvas: commit.canvas ?? {},
          items: commit.items ?? [],
          label: split.full || `Option ${index + 1}`,
          description: option.description ?? '',
        });
        setState('done');
      } catch {
        // Write failed → revert the lock so the founder can retry, and surface it.
        onUnchoose?.();
        setState('error');
      }
      return;
    }
    onChoose?.(); // non-commit select: lock optimistically (a text round-trip, nothing to persist-fail)
    onAction?.('select-option', {
      optionId: option.id ?? String(index),
      label: split.full || `Option ${index + 1}`,
      description: option.description ?? '',
    });
  };

  return (
    <button
      type="button"
      title={locked ? t('chat.skill-locked-hint') : split.full}
      disabled={isDisabled}
      onClick={handleClick}
      className="lp-inline-option"
      style={{
        textAlign: 'left',
        padding: '9px 11px',
        // Chosen option keeps an accent border so the "saved" pick stays obvious
        // after the set locks; everything else uses the default hairline.
        border: chosen ? '1px solid var(--accent)' : '1px solid var(--line-2)',
        borderRadius: 'var(--r-m)',
        background: chosen ? 'var(--accent-wash, var(--paper))' : 'var(--paper)',
        cursor: isDisabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        color: 'var(--ink-2)',
        minWidth: 0,
        // Chosen stays full-strength; un-chosen siblings dim hardest; a plain
        // streaming lock (no pick yet) uses the existing soft 0.6.
        opacity: chosen ? 1 : dimmed ? 0.45 : isDisabled ? 0.6 : 1,
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
          {labelText}
        </span>
        {/* No per-option credit chip: only a founder chat message costs a credit
            (1/message); running an analysis, applying, and committing are free. */}
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
      {state === 'error' && (
        <div style={{ fontSize: 11, color: 'var(--clay, #b4513a)', marginTop: 2 }}>
          {t('chat.run-failed')}
        </div>
      )}
      {locked && (
        <div style={{ fontSize: 11, color: 'var(--ink-5)', marginTop: 2, lineHeight: 1.4 }}>
          {t('chat.skill-locked-hint')}
        </div>
      )}
    </button>
  );
}

function InlineArtifact({
  artifact,
  setId,
  onAction,
}: {
  artifact: Artifact;
  /** Per-message-unique id for the option-set, so its selection can be tracked. */
  setId?: string;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const t = useT();
  const sel = useContext(OptionSelectionContext);
  const a = artifact as unknown as Record<string, unknown>;

  if (artifact.type === 'option-set' && Array.isArray(a.options)) {
    const allOptions = a.options as Array<{ id?: string; label?: string; description?: string; credits?: number; skill_id?: string }>;
    // Strip the idea-shaping kickoff: it re-runs from scratch and the prompt's
    // "always offer next_recommended_skill" rule made it reappear every turn
    // (the loop Luca hit). Relaunch now lives only on the Canvas button; the
    // stable conversational alternatives are the quick-reply strip above the
    // composer. Deterministic strip → no prompt drift can resurface it.
    const options = allOptions.filter((o) => o.skill_id !== 'idea-shaping');
    const prompt = typeof a.prompt === 'string' ? a.prompt : '';
    if (options.length === 0) return null;
    // A set LOCKS once its option was chosen (chosenOptionId set) OR while any
    // response is streaming. Locked = every option non-clickable but still shown
    // ("saved"); the chosen one stays highlighted, the rest dim.
    const uid = setId || (typeof a.id === 'string' ? a.id : '');
    const chosenOptionId = uid ? sel.selectedBySet[uid] : undefined;
    const consumed = chosenOptionId !== undefined;
    const setLocked = consumed || sel.streaming;
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
            const optId = o.id ?? String(i);
            return (
              <InlineOption
                key={o.id || i}
                option={o}
                index={i}
                setLocked={setLocked}
                chosen={consumed && chosenOptionId === optId}
                dimmed={consumed && chosenOptionId !== optId}
                onChoose={() => uid && sel.markSelected(uid, optId)}
                onUnchoose={() => uid && sel.unmarkSelected(uid)}
                onAction={onAction}
              />
            );
          })}
        </div>
      </div>
    );
  }

  if (artifact.type === 'action-suggestion') {
    const title = String(a.title || '—');
    const description = typeof a.description === 'string' ? a.description : '';
    const cta = typeof a.action_label === 'string' ? a.action_label : t('chat.run');
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

  // Watcher proposal — render the Apply/Dismiss card inline so the founder can
  // act on it directly in chat. monitor-proposal is in INLINE_ARTIFACT_TYPES but
  // this if-chain previously had no branch for it, so it silently rendered
  // nothing (every "I don't see the watcher card" traced back here). The
  // watcher-card backstop emits monitor-proposal for BOTH topic and URL watchers.
  if (artifact.type === 'monitor-proposal') {
    return <MonitorProposalCard artifact={artifact} onAction={onAction ?? (() => {})} />;
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
  const t = useT();
  const a = artifact as unknown as Record<string, unknown>;
  const skillId = typeof a.skill_id === 'string' ? a.skill_id : '';
  const label = typeof a.skill_label === 'string' && a.skill_label ? a.skill_label : (skillId || t('chat.skill-fallback'));
  const rationale = typeof a.rationale === 'string' ? a.rationale : '';
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
      setErrMsg(e instanceof Error ? e.message : t('chat.run-failed'));
    }
  };

  const btnLabel =
    state === 'running' ? t('chat.running') :
    state === 'done' ? t('common.done') :
    state === 'error' ? t('common.retry') :
    t('chat.run');

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
        </span>
      </div>
      {state === 'idle' && rationale && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>{rationale}</div>
      )}
      {state === 'running' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {t('chat.skill-running-note')}
        </div>
      )}
      {state === 'done' && (
        <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {t('chat.skill-done-note')}
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
// of silently writing memory. Clicking "Apply to intelligence · 0.5 credits"
// POSTs to /knowledge { apply: true } via handleArtifactAction's
// 'knowledge:apply-inline' verb — which persists the fact as applied AND debits
// 0.5 credits server-side. If ignored, nothing persists (transcript only).
function KnowledgeSuggestionCard({
  artifact,
  onAction,
}: {
  artifact: Artifact;
  onAction?: (action: string, payload: Record<string, unknown>) => Promise<void> | void;
}) {
  const t = useT();
  const a = artifact as unknown as Record<string, unknown>;
  const fact = typeof a.fact === 'string' ? a.fact : '';
  const kind = typeof a.kind === 'string' ? a.kind : 'observation';
  const credits = typeof a.credits === 'number' ? a.credits : KNOWLEDGE_APPLY_CREDITS;
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
      setErrMsg(e instanceof Error ? e.message : t('chat.apply-failed'));
    }
  };

  if (!fact) return null;

  const btnLabel =
    state === 'applying' ? t('chat.applying') :
    state === 'done' ? t('chat.applied') :
    state === 'error' ? t('common.retry') :
    t('chat.apply-to-intelligence', { credits });

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
            {t('chat.saved-to-intelligence')}
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
const TASK_PRIORITY_STYLES: Record<string, { bg: string; fg: string; labelKey: MessageKey }> = {
  critical: { bg: 'var(--clay)',     fg: 'var(--on-accent)', labelKey: 'chat.priority-critical' },
  high:     { bg: 'var(--accent)',   fg: 'var(--ink)',       labelKey: 'chat.priority-high' },
  medium:   { bg: 'var(--sky)',      fg: 'var(--on-accent)', labelKey: 'chat.priority-medium' },
  low:      { bg: 'var(--paper-3)',  fg: 'var(--ink-3)',     labelKey: 'chat.priority-low' },
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
  const t = useT();
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
    const verb = state === 'done' ? t('chat.task-marked-done') : t('chat.task-dismissed');
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
          {t(style.labelKey)}
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
            title={t('chat.estimated-effort')}
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
          {t('chat.task-due', { due })}
        </div>
      )}
      {state === 'snoozed' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginBottom: 6 }}>
          {t('chat.task-snoozed')}
        </div>
      )}
      {state === 'expanding' && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', marginBottom: 6 }}>
          {t('chat.task-expanding')}
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
                const label = r?.title ?? r?.url ?? t('chat.task-ref-fallback', { n: i + 1 });
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
          {t('chat.task-mark-done')}
        </button>
        {canExpand && (
          <button
            type="button"
            // canExpand already excludes 'expanding'; only 'pending' is left as
            // a busy signal here. Plain boolean to avoid a TS narrowing issue.
            disabled={(state as string) === 'pending'}
            onClick={() => trigger('expand')}
            title={t('chat.task-expand-title')}
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
            {t('chat.task-expand')}
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
          {t('chat.task-snooze')}
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
          {t('chat.task-dismiss')}
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
  const t = useT();
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
        title={copied ? t('chat.copied') : t('chat.copy-message')}
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
            {t('chat.copied')}
          </>
        ) : (
          <>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            {t('common.copy')}
          </>
        )}
      </button>
      {onRetry && (
        <button
          type="button"
          onClick={() => onRetry(content)}
          title={t('chat.resend-message')}
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
          {t('common.retry')}
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
  onInsertTemplate,
  onAttachText,
  onAuditDocs,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  disabled: boolean;
  onInsertTemplate?: (text: string) => void;
  onAttachText?: (name: string, body: string) => void;
  /** Opens the priced "audit document → knowledge" popup (distinct from the
   *  inline text attach above, which just pastes file text into the message). */
  onAuditDocs?: () => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const templates = [
    { label: t('chat.template-metrics-label'), text: t('chat.template-metrics-text') },
    { label: t('chat.template-competitor-label'), text: t('chat.template-competitor-text') },
    { label: t('chat.template-icp-label'), text: t('chat.template-icp-text') },
  ];

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 200 * 1024) {
      alert(t('chat.file-too-large'));
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
    <div data-tour="chat-composer" style={{ borderTop: '1px solid var(--line)', padding: 14, background: 'var(--surface)' }}>
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
          placeholder={t('chat.composer-placeholder')}
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
              title={t('chat.composer-actions')}
              onClick={() => setMenuOpen((v) => !v)}
            />
            {menuOpen && (
              <ComposerMenu
                templates={templates}
                onClose={() => setMenuOpen(false)}
                onInsertTemplate={onInsertTemplate}
                onAttach={() => fileInputRef.current?.click()}
                onAuditDocs={onAuditDocs}
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
            title={t('chat.composer-insert-template')}
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
            <Icon d={I.send} size={12} /> {disabled ? '…' : t('chat.composer-send')}
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
  templates,
  onClose,
  onInsertTemplate,
  onAttach,
  onAuditDocs,
}: {
  templates: { label: string; text: string }[];
  onClose: () => void;
  onInsertTemplate?: (text: string) => void;
  onAttach: () => void;
  onAuditDocs?: () => void;
}) {
  const t = useT();
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
        {t('chat.menu-templates')}
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
        {t('chat.menu-attach-file')}
        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-5)' }}>
          {t('chat.menu-attach-hint')}
        </span>
      </button>
      {onAuditDocs && (
        <button
          type="button"
          style={itemStyle}
          onClick={() => {
            onAuditDocs();
            onClose();
          }}
        >
          {t('chat.menu-audit-docs')}
          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--ink-5)' }}>
            {t('chat.menu-audit-docs-hint')}
          </span>
        </button>
      )}
    </div>
  );
}


// =============================================================================
// Strip artifact blocks from message text so the chat column shows only prose
// =============================================================================

function stripArtifacts(content: string): string {
  return content.replace(/:::artifact[\s\S]*?(?::::|$)/g, '').trim();
}
