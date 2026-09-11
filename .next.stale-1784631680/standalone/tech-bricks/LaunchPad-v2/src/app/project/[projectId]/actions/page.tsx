'use client';

/**
 * Inbox — three tabs: Inbox · Signals · Watchers.
 *
 * The Inbox tab is ONE chronological list merging the todo + approval +
 * notification lanes (display-only grouping; lane semantics in
 * src/lib/action-lanes.ts stay authoritative). Row list on the left,
 * selected-row detail panel on the right. Every pending_action is
 * inspectable, approvable, rejectable.
 *
 * Data shape is derived client-side from /api/projects/{id}/actions:
 *   - producer  ← derived from action_type via producerFromType() below.
 *                 One of: chat | heartbeat | signal | correlator.
 *                 Reflects the subsystem that actually wrote the row, not
 *                 a fictional persona. See caveat on `task` in the map.
 *   - goal      ← first clause of rationale or —
 *   - progress  ← status → [0, 30%, 60%, 100%, 0%, 50%]
 *   - cost      ← "—" for now (per-ticket cost would need a new JOIN endpoint)
 *   - ago       ← humanized created_at
 */

import { use, useEffect, useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '@/components/providers/LocaleProvider';
import type { MessageKey } from '@/lib/i18n/messages';
import { useSetChrome } from '@/components/design/chrome-context';
import { PanelBoundary } from '@/components/design/PanelBoundary';
import {
  Pill,
  Icon,
  I,
  IconBtn,
  type PillKind,
} from '@/components/design/primitives';
import type { PendingAction, PendingActionStatus, PendingActionType } from '@/types';
import type { Watcher } from '@/lib/watchers';
import { laneFor, INTEL_INBOX_TYPES } from '@/lib/action-lanes';
import MonitorListPanel from '@/components/monitors/MonitorListPanel';
import { SkillProposalReview } from '@/components/actions/SkillProposalReview';
import { PayloadSummary } from '@/components/actions/PayloadSummary';
import { nodeImportanceKey } from '@/lib/node-importance';

// Tab strip — Inbox / Watchers (radically simplified, 2026-06-11).
//
// DISPLAY-ONLY grouping on top of the lane taxonomy in
// src/lib/action-lanes.ts (which keeps driving backend behaviour like the
// cron stale-notification sweep — do NOT touch laneFor()/ACTION_LANE).
//
// TWO tabs only:
//   - Inbox    → the ONE "apply to intelligence" queue. Shows ONLY the
//                action_types in APPLY_TO_INTELLIGENCE below (watcher findings
//                + knowledge proposals). Every other action_type (run_skill,
//                draft_*, configure_*, workflow_step, task, notification, …)
//                is hidden here — they're not "apply to intelligence". Their
//                executors/types stay intact in the backend; this page just
//                doesn't surface them.
//   - Watchers → MonitorListPanel (config + run logs + "+ New watcher").
//                Reads /watchers, not /actions.
//
// The old Signals tab is GONE: watcher findings (signal_alert) now live in the
// Inbox. The status/type/producer filters and the batch bar are gone too.
type DisplayTab = 'inbox' | 'monitor';
// i18n keys for the tab labels — resolved via t(...) at the render site
// (LaneTabs), mirroring how NavRail stores `labelKey` and resolves with t().
const TAB_LABEL_KEY: Record<DisplayTab, MessageKey> = {
  inbox: 'actions.tab-inbox',
  monitor: 'actions.tab-watchers',
};
// Escape hatch: set NEXT_PUBLIC_INTEL_HIDDEN=1 to hide the Intel (Inbox) tab
// wholesale (Watchers stays). The founder said Intel is "non prioritario per
// alpha" and could simply be hidden — this flag does that without deleting code.
const INTEL_HIDDEN = process.env.NEXT_PUBLIC_INTEL_HIDDEN === '1';

// Watchers FIRST: with SIGNAL_AUTOFLOW live, signals route straight into
// Knowledge at ingest and this page's queue holds only the EXCEPTIONS the
// router couldn't attribute ("Needs review"). The founder's primary object
// here is their sensors, not a queue — "Intel" is retired as a concept
// (nav + breadcrumb + tab all say Watchers / Needs review now).
const TAB_ORDER: DisplayTab[] = INTEL_HIDDEN ? ['monitor'] : ['monitor', 'inbox'];

// The "apply to intelligence" allow-list. ONLY these action_types render in
// the Inbox tab. Anything not here is hidden from this surface (but still lives
// in pending_actions + its executor). Single source of truth = INTEL_INBOX_TYPES
// in src/lib/action-lanes.ts (alpha = WATCHER OUTPUT only; see the note there) —
// the server-side badge count (inboxSummary → NavRail) derives from the SAME
// list via SURFACED_ACTION_TYPES, so badge and page can never drift.
const APPLY_TO_INTELLIGENCE = INTEL_INBOX_TYPES;

// ?lane= deep-link values. Old links carried lane names (todo / approval /
// notification / signal / monitor); all of those now collapse to the Inbox
// tab. New-style values (inbox / watchers) are accepted too.
const LANE_PARAM_TO_TAB: Record<string, DisplayTab> = {
  todo: 'inbox',
  approval: 'inbox',
  notification: 'inbox',
  inbox: 'inbox',
  signal: 'inbox',
  signals: 'inbox',
  monitor: 'monitor',
  watchers: 'monitor',
};

// =============================================================================
// Page
// =============================================================================

interface InboxSummary {
  pending: number;
  edited: number;
  applied_awaiting_send: number;
  sent_last_7d: number;
  rejected_last_7d: number;
}

interface InboxResponse {
  success: boolean;
  data?: { actions: PendingAction[]; summary: InboxSummary };
  error?: string;
}

export default function TicketsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const qc = useQueryClient();
  const t = useT();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Executor narrative toast ("Signal accepted and folded into project
  // knowledge (graph node …)"). Set by transition() on a successful apply,
  // auto-dismissed below. `ts` keys the effect so applying twice with an
  // identical narrative still re-arms the timer.
  const [notice, setNotice] = useState<{ text: string; ts: number } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Display tab + filter dropdowns. Default tab is chosen after first fetch
  // based on whichever tab has the most open rows (a founder with 0 inbox
  // rows and 4 pending signals lands on Signals first). Filters default to
  // 'any' so the list shows everything until the founder narrows.
  const [tab, setTab] = useState<DisplayTab>('monitor');
  const [tabInitialized, setTabInitialized] = useState(false);
  // Deep-link preselection for the Watchers tab: ?lane=monitor&watcher=<id>
  // (old /project/:id/monitors/:monitorId links redirect here). Read once on
  // mount alongside ?lane= below; never synced back to the URL.
  const [deepLinkWatcherId, setDeepLinkWatcherId] = useState<string | null>(null);

  // Cached under ['actions', projectId, 'inbox']. lp-actions-changed events
  // (chat, transitions below) hit this via the QueryProvider bridge.
  const { data: inbox, isLoading: loading, error: queryError } = useQuery<{
    actions: PendingAction[];
    summary: InboxSummary;
  }>({
    queryKey: ['actions', projectId, 'inbox'],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/actions?status=pending,edited,applied,rejected,sent,failed&limit=200`);
      const body: InboxResponse = await res.json();
      if (!body.success || !body.data) throw new Error(body.error || 'Fetch failed');
      return { actions: body.data.actions ?? [], summary: body.data.summary };
    },
  });

  const actions = useMemo(() => inbox?.actions ?? [], [inbox]);

  // Watchers tab badge — the monitor lane reads /watchers (monitors +
  // watch_sources), not /actions, so its count can't be derived from the
  // inbox fetch. Shares queryKey ['watchers', projectId] with
  // MonitorListPanel: react-query dedupes, so opening the Watchers tab later
  // reuses this cache instead of fetching twice. lp-actions-changed
  // invalidation inside MonitorListPanel keeps both in sync after approvals.
  const { data: watchers } = useQuery<Watcher[]>({
    queryKey: ['watchers', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/watchers`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.data)) return [];
      return body.data as Watcher[];
    },
  });

  // Selection coherence is handled below against `filteredActions` (see
  // effect after `filteredActions` is computed). Don't add a second effect
  // against the raw `actions` list — they'd race after an invalidate and
  // briefly render a TicketDetail for a row not in the visible lane.

  // Surface useQuery errors through the existing local `error` slot so the
  // table's error banner keeps working unchanged.
  useEffect(() => {
    if (queryError instanceof Error) setError(queryError.message);
  }, [queryError]);

  // Inbox open count — OPEN rows (pending+edited) among the apply-to-
  // intelligence allow-list only. Hidden action_types (run_skill, drafts,
  // configs, tasks, notifications, …) don't contribute to the Inbox badge
  // because they don't render in the Inbox tab.
  const tabOpenCounts = useMemo<Record<DisplayTab, number>>(() => {
    // The 'monitor' tab reads from /watchers, not /actions — its count stays
    // 0 HERE; the real watcher total is folded in via `tabCounts` below.
    const c: Record<DisplayTab, number> = { inbox: 0, monitor: 0 };
    for (const a of actions) {
      if (
        APPLY_TO_INTELLIGENCE.has(a.action_type) &&
        (a.status === 'pending' || a.status === 'edited')
      ) {
        c.inbox++;
      }
    }
    return c;
  }, [actions]);

  // Tab badges: Inbox counts open apply-to-intelligence rows; Watchers shows
  // the live watcher total (matches the count MonitorListPanel renders).
  const tabCounts = useMemo<Record<DisplayTab, number>>(
    () => ({ ...tabOpenCounts, monitor: watchers?.length ?? 0 }),
    [tabOpenCounts, watchers],
  );

  // After the first successful fetch, pick the tab with the highest open
  // count so the founder lands where the work is. Tie-breaker: Inbox.
  // Override: ?lane=<name> in the URL pins the choice (deep links from Today,
  // plus the /monitors/:monitorId redirect). Old lane names (todo / approval /
  // notification) map to the merged Inbox tab via LANE_PARAM_TO_TAB so
  // pre-merge links keep working. ?watcher=<id> additionally pre-expands that
  // row in the Watchers tab. window.location.search instead of
  // useSearchParams: this page has no Suspense boundary and the read is
  // deliberately once-on-mount, never synced back.
  useEffect(() => {
    if (tabInitialized || loading) return;
    const search = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : null;
    const fromUrl = search?.get('lane') ?? null;
    const validFromUrl = fromUrl ? LANE_PARAM_TO_TAB[fromUrl] ?? null : null;
    const watcherFromUrl = search?.get('watcher') ?? null;
    if (watcherFromUrl) setDeepLinkWatcherId(watcherFromUrl);
    // Watchers is the default landing tab: the needs-review queue is the
    // exception (autoflow routes attributable signals at ingest), so we only
    // leave it for an explicit ?lane= deep link. When Intel is hidden it's
    // also the ONLY tab.
    const winner = INTEL_HIDDEN ? 'monitor' : validFromUrl ?? 'monitor';
    setTab(winner);
    setTabInitialized(true);
  }, [tabOpenCounts, tabInitialized, loading]);

  // The Inbox list: ONLY the apply-to-intelligence action_types, and only
  // rows still awaiting a decision (pending | edited). No status/type/producer
  // filters — this is one flat "apply or dismiss" queue, newest first.
  const filteredActions = useMemo(() => {
    return actions
      .filter((a) =>
        APPLY_TO_INTELLIGENCE.has(a.action_type) &&
        (a.status === 'pending' || a.status === 'edited'),
      )
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [actions]);

  // Keep selection valid inside the filtered view; if the currently-selected
  // row got filtered out, auto-pick the first visible row.
  useEffect(() => {
    if (!selectedId && filteredActions[0]) {
      setSelectedId(filteredActions[0].id);
      return;
    }
    if (selectedId && !filteredActions.find((a) => a.id === selectedId)) {
      setSelectedId(filteredActions[0]?.id ?? null);
    }
  }, [filteredActions, selectedId]);

  function handleTabChange(next: DisplayTab) {
    setTab(next);
  }

  async function transition(actionId: string, verb: 'apply' | 'reject' | 'mark_sent', extras: Record<string, unknown> = {}) {
    try {
      const res = await fetch(`/api/projects/${projectId}/actions/${actionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transition: verb, ...extras }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error || `${verb} failed`);
      const deliverable = body.data?.deliverable;
      if (deliverable?.mode === 'click-to-send' && deliverable.url) {
        window.open(deliverable.url, '_blank', 'noopener,noreferrer');
      }
      // Executor narratives ("Signal accepted and folded into project
      // knowledge (graph node …)") used to be dropped on the floor — only
      // click-to-send was consumed. Surface them as a transient toast; the
      // durable copy lands in the detail pane's Activity section via
      // execution_result.response after the refetch below.
      if (typeof deliverable?.narrative === 'string' && deliverable.narrative.trim()) {
        setNotice({ text: deliverable.narrative.trim(), ts: Date.now() });
      }
      // Refresh the inbox + the NavRail badge count. The event bridge would
      // also catch this if we dispatched lp-actions-changed; calling
      // invalidateQueries directly keeps the dispatcher local to the
      // component that mutated state.
      await qc.invalidateQueries({ queryKey: ['actions', projectId] });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selected = filteredActions.find(a => a.id === selectedId) || null;

  // Open count = the apply-to-intelligence rows awaiting a decision.
  const openCount = tabOpenCounts.inbox;

  // Publish this page's chrome bits to the persistent project layout (TopBar
  // breadcrumb + right pill, StatusBar). Props copied verbatim from the
  // TopBar/StatusBar this page used to render itself.
  useSetChrome(
    {
      breadcrumb: [t('actions.breadcrumb-project'), t('actions.breadcrumb-inbox')],
      right: (
        <Pill kind="n">
          {t('actions.right-pill', { total: actions.length, count: openCount })}
        </Pill>
      ),
      status: {
        heartbeatLabel: t('actions.heartbeat-label'),
        gateway: 'pi-agent · anthropic',
        ctxLabel: `ctx · ${filteredActions.length} / ${actions.length}`,
        budget: t('actions.open-count', { count: openCount }),
      },
    },
    [actions.length, openCount, filteredActions.length],
  );

  return (
    <div className="lp-rise" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <InboxSubhead />
      <LaneTabs
        active={tab}
        counts={tabCounts}
        onChange={handleTabChange}
      />

      {tab === 'monitor' ? (
        // Watchers lane reads from /watchers, not /actions. The panel owns
        // its own scroll, renders the "+ New watcher" form inline, and
        // expands rows in place (config + run logs). deepLinkWatcherId
        // pre-expands the row from ?watcher=<id>.
        <div data-tour="watchers-list" style={{ flex: 1, overflow: 'auto', background: 'var(--paper)' }}>
          {/* Boundary-wrapped like the Home panels: one render throw degrades
              to a muted card instead of dropping the WHOLE Inbox surface to
              the route error screen (blast-radius audit, 2026-07-11). */}
          <PanelBoundary resetKey={projectId}>
            <MonitorListPanel
              projectId={projectId}
              initialExpandedWatcherId={deepLinkWatcherId ?? undefined}
            />
          </PanelBoundary>
        </div>
      ) : (
        // Inbox = the ONE apply-to-intelligence queue. No toolbar, no
        // filters: a flat list where each row is title + brief + one
        // action pair (Apply · 0.5 credits / Dismiss). Selecting a row opens
        // the read-only inspector pane on the right.
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', minHeight: 0 }}>
          <PanelBoundary resetKey={projectId}>
            <InboxList
              rows={filteredActions}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onTransition={transition}
              loading={loading}
              error={error}
            />
          </PanelBoundary>
          {selected && (
            // Keyed by the selected row too: a crash on ONE malformed action
            // must not leave the inspector dead for every other row.
            <PanelBoundary resetKey={`${projectId}:${selected.id}`}>
              <TicketDetail
                action={selected}
                onTransition={transition}
              />
            </PanelBoundary>
          )}
        </div>
      )}

      {notice && (
        // Narrative toast — what the apply actually DID, straight from the
        // executor's deliverable. Fixed above the StatusBar; click or wait
        // ~6s to dismiss. Deliberately dependency-free (no toast lib).
        <div
          role="status"
          aria-live="polite"
          onClick={() => setNotice(null)}
          title={t('actions.dismiss')}
          style={{
            position: 'fixed',
            right: 16,
            bottom: 34,
            zIndex: 50,
            maxWidth: 420,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            padding: '10px 14px',
            background: 'var(--surface)',
            border: '1px solid var(--line)',
            borderLeft: '3px solid var(--moss)',
            borderRadius: 'var(--r-m)',
            boxShadow: 'var(--shadow-lift)',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--ink-2)',
            fontFamily: 'var(--f-sans)',
            cursor: 'pointer',
          }}
        >
          <Icon d={I.check} size={13} style={{ color: 'var(--moss)', flexShrink: 0, marginTop: 2 }} />
          <span>{notice.text}</span>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Subhead — frames the Inbox as the apply-to-intelligence queue.
// Always-visible one-liner that sets expectation on every visit. Sits
// between the TopBar and the LaneTabs so it lands in the natural reading
// path. Uses the same surface as LaneTabs so it reads as part of the strip.
// =============================================================================

function InboxSubhead() {
  const t = useT();
  return (
    <div
      style={{
        padding: '8px 20px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        fontSize: 12,
        color: 'var(--ink-4)',
        fontFamily: 'var(--f-sans)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <span style={{ color: 'var(--ink-2)', fontWeight: 500 }}>
        {t('actions.subhead-title')}
      </span>
      <span>
        {t('actions.subhead-desc')}
      </span>
    </div>
  );
}

// =============================================================================
// Lane tabs — 2-tab strip (Inbox · Watchers)
// =============================================================================

function LaneTabs({
  active,
  counts,
  onChange,
}: {
  active: DisplayTab;
  counts: Record<DisplayTab, number>;
  onChange: (t: DisplayTab) => void;
}) {
  const t = useT();
  return (
    <div
      data-tour="inbox-tabs"
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        paddingLeft: 12,
      }}
    >
      {TAB_ORDER.map((l) => {
        const isActive = l === active;
        return (
          <button
            key={l}
            onClick={() => onChange(l)}
            style={{
              padding: '12px 18px',
              background: 'transparent',
              border: 'none',
              borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              color: isActive ? 'var(--ink-1)' : 'var(--ink-4)',
              fontWeight: isActive ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: 'var(--f-sans)',
              marginBottom: -1, // overlap the border-bottom for active underline
            }}
          >
            <span>{t(TAB_LABEL_KEY[l])}</span>
            {counts[l] > 0 && (
              <Pill kind={isActive ? 'info' : 'n'}>{counts[l]}</Pill>
            )}
          </button>
        );
      })}
    </div>
  );
}

// =============================================================================
// Inbox list
// =============================================================================

const STATUS_PILL: Record<PendingActionStatus, PillKind> = {
  pending: 'live',
  edited: 'info',
  applied: 'ok',
  sent: 'ok',
  rejected: 'n',
  failed: 'warn',
};

// Founder-facing status labels. The raw machine values (pending/applied/…)
// stay in component state and API calls — only the rendered text changes.
// "applied" reads as bureaucratic success; "Approved" says what the founder
// actually did. "rejected" → "Dismissed" because half the rejects are just
// clearing notifications, not value judgements.
// i18n keys for the founder-facing status labels — resolved via t(...) at the
// render site (TicketDetail). The map keys stay the raw machine status values.
const STATUS_LABEL_KEY: Record<PendingActionStatus, MessageKey> = {
  pending: 'actions.status-waiting',
  edited: 'actions.status-edited',
  applied: 'actions.status-approved',
  sent: 'actions.status-done',
  rejected: 'actions.status-dismissed',
  failed: 'actions.status-failed',
};


// Small type chip on each inbox row — a human label for the kind of
// intelligence item (Signal / Graph update / Assumption / Brief). Pure
// presentation; lane semantics keep driving executors underneath.
function TypeChip({ title }: { title: string }) {
  return (
    <span
      className="lp-mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '1px 7px',
        borderRadius: 999,
        border: '1px solid var(--line-2)',
        background: 'var(--paper)',
        fontSize: 9.5,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color: 'var(--ink-4)',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 3, background: 'var(--plum)' }} />
      {title}
    </span>
  );
}

// The Inbox list — the apply-to-intelligence queue. Each row is title + short
// brief + ONE action pair (Apply · 0.5 credits / Dismiss). Nothing else.
function InboxList({
  rows,
  selectedId,
  onSelect,
  onTransition,
  loading,
  error,
}: {
  rows: PendingAction[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onTransition: (id: string, verb: 'apply' | 'reject' | 'mark_sent') => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const t = useT();
  if (error) {
    return (
      <div style={{ padding: 20, color: 'var(--clay)', fontSize: 12 }}>
        {error}
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
        {t('actions.loading-inbox')}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
        {t('actions.empty-state')}
      </div>
    );
  }

  return (
    <div className="lp-scroll" style={{ overflow: 'auto', background: 'var(--surface)' }}>
      {rows.map((r) => (
        <InboxRow
          key={r.id}
          action={r}
          selected={r.id === selectedId}
          onSelect={onSelect}
          onTransition={onTransition}
        />
      ))}
    </div>
  );
}

// One Inbox row — title + short brief + ONE action pair. Apply (moss, with
// the "· N credits" cost label) runs the audited POST {transition:'apply'};
// Dismiss (line border) runs {transition:'reject'}. Both reuse the page-level
// transition() machinery so executor narratives + the cache invalidate flow
// unchanged. Selecting the row opens the read-only inspector on the right.
function InboxRow({
  action,
  selected,
  onSelect,
  onTransition,
}: {
  action: PendingAction;
  selected: boolean;
  onSelect: (id: string) => void;
  onTransition: (id: string, verb: 'apply' | 'reject' | 'mark_sent') => Promise<void>;
}) {
  const t = useT();
  // Short brief: first line of the rationale, trimmed to one tidy line.
  const brief = typeof action.rationale === 'string' ? action.rationale.trim() : '';
  const briefLine = brief.length > 160 ? `${brief.slice(0, 160)}…` : brief;

  return (
    <div
      onClick={() => onSelect(action.id)}
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        background: selected ? 'var(--accent-wash)' : 'transparent',
        cursor: 'pointer',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <TypeChip title={typeLabelKey(action.action_type) ? t(typeLabelKey(action.action_type)!) : action.action_type.replace(/_/g, ' ')} />
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {action.title}
          </span>
        </div>
        {briefLine && (
          <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 4, lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {briefLine}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTransition(action.id, 'apply'); }}
          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: 'none', background: 'var(--moss)', color: 'var(--paper)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {t('actions.apply-credits')}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onTransition(action.id, 'reject'); }}
          style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink-2)', cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          {t('actions.dismiss')}
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Detail panel
// =============================================================================

function TicketDetail({
  action,
  onTransition,
}: {
  action: PendingAction;
  onTransition: (id: string, verb: 'apply' | 'reject' | 'mark_sent') => Promise<void>;
}) {
  const t = useT();
  const producer = producerFromType(action.action_type, action.ecosystem_alert_id);
  const canAct = action.status === 'pending' || action.status === 'edited';
  const awaitingClick = action.status === 'applied';

  return (
    <div
      className="lp-scroll"
      style={{ borderLeft: '1px solid var(--line)', overflow: 'auto', background: 'var(--surface)' }}
    >
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Pill kind={STATUS_PILL[action.status] || 'n'} dot>
            {STATUS_LABEL_KEY[action.status] ? t(STATUS_LABEL_KEY[action.status]) : action.status}
          </Pill>
          <Pill kind="n">{producer}</Pill>
        </div>
        <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginBottom: 2 }}>
          T-{action.id.slice(-6)} · {timeAgo(action.created_at)}
        </div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.3, letterSpacing: -0.2 }}>
          {action.title}
        </h3>
      </div>

      {action.rationale && (
        <SideSection title={t('actions.section-brief')}>
          <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            {action.rationale}
          </div>
        </SideSection>
      )}

      {/* The synthesized "Activity · N events" log was removed (2026-06) —
          it reconstructed a timeline from 4 columns and mostly printed noise
          ("Queued Hypothesis", "Executed delivery") on already-done items.
          The real outcome now shows as one line in the Outcome section below. */}

      {action.action_type === 'configure_monitor' ? (
        <MonitorProposalReview action={action} />
      ) : action.action_type === 'run_skill' ? (
        // Skill kickoffs SPEND credits on approval — they get a human card
        // (what you'll get / cost / duration), never a raw JSON dump.
        <SideSection title={t('actions.section-skill-run')}>
          <SkillProposalReview action={action} />
        </SideSection>
      ) : (
        // Everything else: tidy key→value summary; full JSON behind the
        // pane's "view raw" toggle.
        <SideSection title={t('actions.section-details')}>
          <PayloadSummary payload={action.edited_payload || action.payload} />
        </SideSection>
      )}

      {/* What applying this adds to the project — so the founder knows why it's
          worth merging, not just what it says. Only while it can still be acted on. */}
      {canAct && (
        <SideSection title={t('actions.section-what-adds')}>
          <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            {t(nodeImportanceKey(
              (action.edited_payload as { node_type?: string; kind?: string } | null)?.node_type
              ?? (action.payload as { node_type?: string; kind?: string } | null)?.node_type
              ?? (action.payload as { node_type?: string; kind?: string } | null)?.kind
              ?? action.action_type,
            ))}
          </div>
        </SideSection>
      )}

      <SideSection title={canAct || awaitingClick ? t('actions.section-human-actions') : t('actions.section-outcome')}>
        <LaneAwareActions action={action} canAct={canAct} awaitingClick={awaitingClick} onTransition={onTransition} />
      </SideSection>
    </div>
  );
}

// Lane-specific verb set. The underlying API contract is the same (transition
// verbs against /actions/[actionId]) but the labels + ordering reflect what
// the founder is actually doing in each lane:
//   TODO         → Mark done (apply) | Snooze (edit) | Dismiss (reject)
//   APPROVAL     → Apply | Reject (run_skill applies as "Run skill (≈N credits)";
//                  signal_alert applies as "Accept into knowledge" and rejects
//                  as "Dismiss" — see label special-cases below)
//   NOTIFICATION → Acknowledge (reject = clear from inbox)
function LaneAwareActions({
  action,
  canAct,
  awaitingClick,
  onTransition,
}: {
  action: PendingAction;
  canAct: boolean;
  awaitingClick: boolean;
  onTransition: (id: string, verb: 'apply' | 'reject' | 'mark_sent') => Promise<void>;
}) {
  const t = useT();
  const lane = laneFor(action.action_type);

  if (!canAct && !awaitingClick) {
    // One quiet outcome line instead of a dead-end "nothing to do" + a
    // synthesized event log. Prefer the executor's own narrative (e.g.
    // "Signal accepted and folded into project knowledge…"); never the legacy
    // "Queued Hypothesis"/"Executed delivery" wording.
    const when = timeAgo(action.executed_at || action.updated_at || action.created_at);
    const narrative = typeof action.execution_result?.response === 'string'
      ? action.execution_result.response.trim()
      : '';
    const outcome = action.status === 'rejected'
      ? t('actions.outcome-dismissed')
      : action.status === 'failed'
        ? t('actions.outcome-failed')
        : (narrative || t('actions.outcome-done'));
    return (
      <div style={{ padding: 14, fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {outcome}
        <span style={{ color: 'var(--ink-5)', marginLeft: 6 }}>· {when}</span>
      </div>
    );
  }

  if (awaitingClick) {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => onTransition(action.id, 'mark_sent')}
          style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--moss)' }}
        >
          <Icon d={I.check} size={12} /> {t('actions.mark-as-sent')}
        </button>
      </div>
    );
  }

  if (lane === 'notification') {
    // System-generated notice — only verb is acknowledge (clear from inbox).
    // We map "acknowledge" to the reject transition because the action has no
    // executor; reject is the terminal state that takes it out of the open
    // counts. The "rejected" label is a state-machine artifact, not a value
    // judgement on the notification.
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => onTransition(action.id, 'reject')}
          style={{ ...btnGhost, justifyContent: 'flex-start' }}
        >
          <Icon d={I.check} size={12} /> {t('actions.acknowledge')}
        </button>
        <div style={{ fontSize: 10.5, color: 'var(--ink-5)', padding: '4px 8px', lineHeight: 1.5 }}>
          {t('actions.notifications-auto-clear')}
        </div>
      </div>
    );
  }

  if (lane === 'todo') {
    return (
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => onTransition(action.id, 'apply')}
          style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--moss)' }}
        >
          <Icon d={I.check} size={12} /> {t('actions.mark-done')}
        </button>
        <button
          onClick={() => onTransition(action.id, 'reject')}
          style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--clay)' }}
        >
          <Icon d={I.stop} size={12} /> {t('actions.dismiss')}
        </button>
      </div>
    );
  }

  // Default: approval lane (drafts, configs, workflow steps).
  // Two label special-cases — the transition verb stays 'apply' for both:
  //   - run_skill SPENDS credits on approval, so the button says the cost.
  //   - signal_alert's apply executor files the finding into the knowledge
  //     graph (acceptAlertIntoKnowledge) — generic "Apply" undersells the
  //     decision, and the old notification-lane "Acknowledge" fired reject,
  //     which made Accept unreachable (the B1 blocker). Primary verb names
  //     the outcome; secondary reads "Dismiss" because declining a signal is
  //     triage, not a judgement on a draft.
  // Items that MERGE into the knowledge graph on apply name that outcome so the
  // founder knows the click commits it to Knowledge (not a generic "Apply").
  const KNOWLEDGE_MERGE_TYPES = new Set(['proposed_graph_update', 'assumption_review', 'intelligence_brief']);
  const applyLabel =
    action.action_type === 'run_skill'
      ? t('actions.run-skill-credits')
      : action.action_type === 'signal_alert'
        ? t('actions.accept-into-knowledge')
        : KNOWLEDGE_MERGE_TYPES.has(action.action_type)
          ? t('actions.apply-to-knowledge')
          : t('actions.apply');
  const rejectLabel = action.action_type === 'signal_alert' ? t('actions.dismiss') : t('actions.reject');
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => onTransition(action.id, 'apply')}
        style={{ ...btnGhost, justifyContent: 'flex-start', ...(action.action_type === 'signal_alert' ? { color: 'var(--moss)' } : {}) }}
      >
        <Icon d={I.check} size={12} /> {applyLabel}
      </button>
      <button
        onClick={() => onTransition(action.id, 'reject')}
        style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--clay)' }}
      >
        <Icon d={I.stop} size={12} /> {rejectLabel}
      </button>
    </div>
  );
}

function SideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div
        style={{
          padding: '10px 14px',
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          background: 'var(--paper-2)',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Structured review pane for configure_monitor proposals — replaces the JSON
 * dump with title / objective / prompt / schedule / tracked URLs / sources.
 *
 * Payload keys vary by generation: current propose_monitor rows carry
 * objective/urls_to_track/alert_threshold, legacy/alternate rows only
 * kind/name/query/sources. Every field below has a fallback chain so neither
 * shape renders a pane of em-dashes. sources[] is the founder's quoted
 * rationale (mandatory-sources schema: {type, title?, url?, quote?, ref?,
 * ref_id?}) — the "why" behind the watcher, rendered when present.
 */
function MonitorProposalReview({ action }: { action: PendingAction }) {
  const t = useT();
  const raw = action.edited_payload || action.payload || {};
  const p = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  const name = str(p.name) || action.title;
  const query = str(p.query);
  // Objective fallback chain ends on the query so legacy rows (which only
  // describe themselves via query) don't show "—" as their reason to exist.
  const objective = str(p.objective) || str(p.linked_quote) || query || '—';
  const kind = str(p.kind);
  const schedule = str(p.schedule) || t('actions.schedule-weekly');
  const urls = arr(p.urls_to_track);
  const threshold = str(p.alert_threshold);
  // Prompt is what the monitor will actually run. It's typically not on the
  // proposal payload (the executor leaves it null), so we surface the query
  // as the next-best approximation when prompt is absent.
  const prompt = str(p.prompt) || query;
  // Founder-rationale sources (quotes, risk refs, web links).
  const sources = Array.isArray(p.sources)
    ? p.sources.filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    : [];

  return (
    <SideSection title={t('actions.monitor-proposal')}>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
        <Field label={t('actions.field-title')} value={name} />
        <Field label={t('actions.field-objective')} value={objective} multiline />
        {kind && <Field label={t('actions.field-kind')} value={kind.replace(/[_-]+/g, ' ')} />}
        <Field label={t('actions.field-prompt')} value={prompt || '—'} multiline mono />
        <Field label={t('actions.field-schedule')} value={schedule} />
        {threshold && <Field label={t('actions.field-alert-threshold')} value={threshold} multiline />}
        {urls.length > 0 && (
          <div>
            <FieldLabel>{t('actions.tracked-urls')}</FieldLabel>
            <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {urls.map((u) => (
                <li key={u} style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--ink-3)', wordBreak: 'break-all' }}>
                  <a href={u} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{u}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {sources.length > 0 && (
          <div>
            <FieldLabel>{t('actions.sources-why-watcher')}</FieldLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
              {sources.map((s, i) => {
                const quote = str(s.quote);
                const title = str(s.title);
                const url = str(s.url);
                const ref = str(s.ref);
                const refId = str(s.ref_id);
                return (
                  <div key={i} style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                    {quote && (
                      <div style={{ fontStyle: 'italic', color: 'var(--ink-2)' }}>&ldquo;{quote}&rdquo;</div>
                    )}
                    {(title || ref) && (
                      <div className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: quote ? 2 : 0 }}>
                        {title}
                        {title && ref ? ' · ' : ''}
                        {ref}
                        {refId ? ` ${refId}` : ''}
                      </div>
                    )}
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--accent)', fontSize: 11.5, fontFamily: 'var(--f-mono)', wordBreak: 'break-all', textDecoration: 'none' }}
                      >
                        {url}
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </SideSection>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="lp-mono"
      style={{
        fontSize: 10,
        color: 'var(--ink-5)',
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginBottom: 3,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, value, multiline, mono }: { label: string; value: string; multiline?: boolean; mono?: boolean }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div
        style={{
          color: 'var(--ink-2)',
          fontSize: 12.5,
          whiteSpace: multiline ? 'pre-wrap' : 'nowrap',
          overflow: multiline ? undefined : 'hidden',
          textOverflow: multiline ? undefined : 'ellipsis',
          fontFamily: mono ? 'var(--f-mono)' : 'inherit',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// =============================================================================
// Derivation helpers (client-side)
// =============================================================================

// Map action_type → the subsystem that actually inserted the pending_actions
// row. Truthful attribution, not persona theatre. Detail-pane-only after the
// field diet: list rows no longer render producer badges and the toolbar
// filter is gone, but the detail header pill + Activity log keep using this.
//
// Caveat for `task`: rows can come from chat artifacts (artifact-persistence
// + project-tools), the heartbeat task proposer (cron/route.ts:204), or the
// watch source auto-task path (watch-source-processor.ts:264). The UI only
// sees action_type, so we default to the dominant producer (chat). Promoting
// this to per-row truth requires adding a `produced_by` column to
// pending_actions and stamping it at insert. Same caveat, smaller, for the
// draft_* / proposed_* family: the ecosystem-alert fan-out can also create
// them, but chat artifacts dominate.
function producerFromType(type: PendingActionType, ecosystemAlertId?: string | null): string {
  // A proposed_hypothesis / proposed_graph_update that carries an
  // ecosystem_alert FK was NOT written by chat — the alert fan-out
  // (persistEcosystemAlerts) queued it from a watcher signal. Attribute it to
  // the signal subsystem so the producer badge matches reality (the static map
  // below can't tell chat-born from alert-born by type alone — hence the FK
  // check here). signal_alert is already 'signal' in the map.
  if (ecosystemAlertId && (type === 'proposed_hypothesis' || type === 'proposed_graph_update')) {
    return 'signal';
  }
  const map: Record<PendingActionType, string> = {
    // Chat-born drafts + tool proposals (artifact-persistence.ts,
    // project-tools.ts, skill-tools.ts) — the chat agent wrote the row.
    draft_email: 'chat',
    draft_linkedin_post: 'chat',
    draft_linkedin_dm: 'chat',
    proposed_hypothesis: 'chat',
    proposed_interview_question: 'chat',
    proposed_landing_copy: 'chat',
    proposed_investor_followup: 'chat',
    proposed_graph_update: 'chat',
    workflow_step: 'chat',
    configure_monitor: 'chat',
    edit_monitor: 'chat',
    delete_monitor: 'chat',
    configure_budget: 'chat',
    configure_watch_source: 'chat',
    run_skill: 'chat',
    validation_proposal: 'chat',
    task: 'chat',
    // Assumption extraction runs inside a chat tool call (project-tools →
    // lib/assumptions.ts), so the review rows are chat-produced too.
    assumption_review: 'chat',
    // Heartbeat executor refreshed a stale analytical skill.
    skill_rerun_result: 'heartbeat',
    // Materialized from ecosystem_alerts — written by the signal subsystem
    // (monitor runs + watch-source processor).
    signal_alert: 'signal',
    // Produced when a competitor-pricing signal is accepted (acceptAlertIntoKnowledge).
    propose_assumption_revision: 'signal',
    // Materialized from intelligence_briefs (intelligence-correlator.ts).
    intelligence_brief: 'correlator',
  };
  return map[type] || 'unknown';
}

// i18n key per action_type for the human-readable type chip. Replaces the old
// underscore-to-space label that surfaced raw schema slugs like "configure
// monitor". Resolved via t(...) at the render site (TypeChip in InboxRow);
// the map keys stay the raw machine action_type values.
const TYPE_LABEL_KEY: Record<PendingActionType, MessageKey> = {
  draft_email:                  'actions.type-email-draft',
  draft_linkedin_post:          'actions.type-linkedin-post',
  draft_linkedin_dm:            'actions.type-linkedin-dm',
  proposed_hypothesis:          'actions.type-hypothesis',
  proposed_interview_question:  'actions.type-interview-question',
  proposed_landing_copy:        'actions.type-landing-copy',
  proposed_investor_followup:   'actions.type-investor-followup',
  proposed_graph_update:        'actions.type-graph-update',
  workflow_step:                'actions.type-workflow-step',
  configure_monitor:            'actions.type-new-watcher',
  edit_monitor:                 'actions.type-edit-watcher',
  delete_monitor:               'actions.type-delete-watcher',
  configure_budget:             'actions.type-budget-change',
  configure_watch_source:       'actions.type-new-watcher',
  run_skill:                    'actions.type-skill-kickoff',
  validation_proposal:          'actions.type-validation',
  skill_rerun_result:           'actions.type-skill-refresh',
  task:                         'actions.type-todo',
  // Unified-inbox surface (Phase 1 consolidation).
  signal_alert:                 'actions.type-signal',
  intelligence_brief:           'actions.type-brief',
  assumption_review:            'actions.type-assumption',
  propose_assumption_revision:  'actions.type-assumption-revision',
};

// Returns the i18n key for an action_type's chip label, or null when the type
// isn't in the map (the render site falls back to the slug, which is not
// translatable copy).
function typeLabelKey(type: PendingActionType): MessageKey | null {
  return TYPE_LABEL_KEY[type] ?? null;
}

function timeAgo(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  } catch {
    return '—';
  }
}

// buildActivity() + ActivityEvent removed (2026-06) — the synthesized
// per-action timeline was founder-facing noise (see TicketDetail). The real
// outcome renders as one line in LaneAwareActions' terminal branch.

// =============================================================================
// Local styles
// =============================================================================

const btnGhost: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 'var(--r-m)',
  background: 'transparent',
  color: 'var(--ink-2)',
  border: '1px solid var(--line-2)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
};
