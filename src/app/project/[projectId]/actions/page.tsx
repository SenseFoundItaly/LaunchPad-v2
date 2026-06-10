'use client';

/**
 * Tickets & Audit — ported from screen-tickets.jsx.
 *
 * Linear-style table on the left, selected-ticket detail panel on the right.
 * Every pending_action is a ticket — inspectable, approvable, rejectable.
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
import { TopBar, NavRail } from '@/components/design/chrome';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import {
  Pill,
  StatusBar,
  Icon,
  I,
  IconBtn,
  type PillKind,
} from '@/components/design/primitives';
import type { PendingAction, PendingActionStatus, PendingActionType, ActionLane } from '@/types';
import { laneFor } from '@/lib/action-lanes';
import MonitorListPanel from '@/components/monitors/MonitorListPanel';
import { SkillProposalReview, skillCreditsFromAction } from '@/components/actions/SkillProposalReview';
import { PayloadSummary } from '@/components/actions/PayloadSummary';

// Phase 1 — 3-lane Inbox (Tasks / Approvals / Notifications).
// See /Users/openmaiku/.claude/plans/buckets-tasks-intelligence-signals-assets.md
//
// Every pending_action falls into exactly one lane, derived from action_type
// via ACTION_LANE in src/lib/pending-actions.ts. Tabs filter client-side; the
// underlying fetch is still the full /actions endpoint so a founder switching
// tabs doesn't incur a round-trip.
const LANE_LABEL: Record<ActionLane, string> = {
  todo: 'TODOs',
  approval: 'Approvals',
  notification: 'Notifications',
  monitor: 'Watchers',
};
const LANE_ORDER: ActionLane[] = ['todo', 'approval', 'notification', 'monitor'];

// Real producers, not persona fiction. Each row is written by exactly one of
// these subsystems; the label below is derived from `action_type` via
// producerFromType() and matches what actually inserted the row.
const PRODUCER_OPTIONS = ['any', 'chat', 'heartbeat', 'signal', 'correlator'] as const;
const STATUS_OPTIONS: Array<'any' | PendingActionStatus> = ['any', 'pending', 'edited', 'applied', 'sent', 'rejected', 'failed'];

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
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lane tab + filter dropdowns. Default lane is chosen after first fetch
  // based on whichever lane has the most open rows (so a founder with 12
  // approvals and 0 TODOs lands on Approvals first). Filters default to 'any'
  // so the list matches the pre-Phase-1 behaviour until the founder narrows.
  const [lane, setLane] = useState<ActionLane>('todo');
  const [laneInitialized, setLaneInitialized] = useState(false);
  const [producerFilter, setProducerFilter] = useState<string>('any');
  const [statusFilter, setStatusFilter] = useState<'any' | PendingActionStatus>('any');
  const [typeFilter, setTypeFilter] = useState<string>('any');

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
  const summary = inbox?.summary ?? null;

  // Selection coherence is handled below against `filteredActions` (see
  // effect after `filteredActions` is computed). Don't add a second effect
  // against the raw `actions` list — they'd race after an invalidate and
  // briefly render a TicketDetail for a row not in the visible lane.

  // Surface useQuery errors through the existing local `error` slot so the
  // table's error banner keeps working unchanged.
  useEffect(() => {
    if (queryError instanceof Error) setError(queryError.message);
  }, [queryError]);

  // Lane counts for the tab strip — only OPEN rows count (pending+edited),
  // matching what the footer's `openCount` already tracks. Terminal-state
  // rows still appear in the list if the dropdown filter allows, but the
  // tab badge shouldn't scream "12!" when 11 of those are already sent.
  const laneCounts = useMemo<Record<ActionLane, number>>(() => {
    // The 'monitor' lane reads from /monitors, not /actions — its count
    // shouldn't double-bill against pending_actions. We display a separate
    // monitors badge inside MonitorListPanel itself.
    const c: Record<ActionLane, number> = { todo: 0, approval: 0, notification: 0, monitor: 0 };
    for (const a of actions) {
      if (a.status === 'pending' || a.status === 'edited') {
        c[laneFor(a.action_type)]++;
      }
    }
    return c;
  }, [actions]);

  // After the first successful fetch, pick the lane with the highest open
  // count so the founder lands where the work is. Tie-breaker: TODOs.
  // Override: ?lane=<name> in the URL pins the choice (deep links from Today).
  useEffect(() => {
    if (laneInitialized || loading) return;
    const fromUrl = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('lane')
      : null;
    const validFromUrl = fromUrl && (LANE_ORDER as string[]).includes(fromUrl)
      ? (fromUrl as ActionLane)
      : null;
    const winner = validFromUrl ?? LANE_ORDER.reduce<ActionLane>(
      (best, l) => (laneCounts[l] > laneCounts[best] ? l : best),
      'todo',
    );
    setLane(winner);
    setLaneInitialized(true);
  }, [laneCounts, laneInitialized, loading]);

  // Available action_types within the current lane — powers the 'type' dropdown.
  const typeOptions = useMemo<string[]>(() => {
    const inLane = actions.filter((a) => laneFor(a.action_type) === lane);
    const unique = Array.from(new Set(inLane.map((a) => a.action_type))).sort();
    return ['any', ...unique];
  }, [actions, lane]);

  // Apply lane + dropdown filters. Keeps the full `actions` array as the
  // source of truth so lane-switching is instant (no re-fetch).
  const filteredActions = useMemo(() => {
    return actions.filter((a) => {
      if (laneFor(a.action_type) !== lane) return false;
      if (statusFilter !== 'any' && a.status !== statusFilter) return false;
      if (typeFilter !== 'any' && a.action_type !== typeFilter) return false;
      if (producerFilter !== 'any' && producerFromType(a.action_type) !== producerFilter) return false;
      return true;
    });
  }, [actions, lane, statusFilter, typeFilter, producerFilter]);

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

  // Reset dropdowns when switching lane — stops "status=sent" from silently
  // suppressing the new lane's open rows.
  function handleLaneChange(next: ActionLane) {
    setLane(next);
    setProducerFilter('any');
    setStatusFilter('any');
    setTypeFilter('any');
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
  const openCount = (summary?.pending ?? 0) + (summary?.edited ?? 0);

  return (
    <div className="lp-frame">
      <TopBar
        projectId={projectId}
        breadcrumb={['Project', 'Inbox']}
        right={
          <Pill kind="n">
            {actions.length} · {openCount} open
          </Pill>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="tickets" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <InboxSubhead />
          <LaneTabs
            active={lane}
            counts={laneCounts}
            onChange={handleLaneChange}
          />

          {lane === 'monitor' ? (
            // Monitor lane reads from /monitors, not /actions — no toolbar,
            // no row-selection detail pane. The panel owns its own scroll
            // and renders the "+ New monitor" CTA inline.
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--paper)' }}>
              <MonitorListPanel projectId={projectId} />
            </div>
          ) : (
            <>
              <TicketsToolbar
                total={filteredActions.length}
                open={laneCounts[lane]}
                producerFilter={producerFilter}
                setProducerFilter={setProducerFilter}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
                typeFilter={typeFilter}
                setTypeFilter={setTypeFilter}
                typeOptions={typeOptions}
              />

              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', minHeight: 0 }}>
                <TicketsTable
                  rows={filteredActions}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  loading={loading}
                  error={error}
                  lane={lane}
                />
                {selected && (
                  <TicketDetail
                    action={selected}
                    onTransition={transition}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${filteredActions.length} / ${actions.length}`}
        budget={`${openCount} open`}
      />
    </div>
  );
}

// =============================================================================
// Subhead — frames Inbox as the downstream of Signals.
// Always-visible one-liner that sets expectation on every visit. Sits
// between the TopBar and the LaneTabs so it lands in the natural reading
// path. Uses the same surface as LaneTabs so it reads as part of the strip.
// =============================================================================

function InboxSubhead() {
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
        Everything proposed for your review.
      </span>
      <span>
        Tasks to do, drafts to approve, signals & briefs to acknowledge. Apply or reject — each accepted item lands in Knowledge.
      </span>
    </div>
  );
}

// =============================================================================
// Lane tabs — 3-lane strip above the toolbar
// =============================================================================

function LaneTabs({
  active,
  counts,
  onChange,
}: {
  active: ActionLane;
  counts: Record<ActionLane, number>;
  onChange: (l: ActionLane) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        paddingLeft: 12,
      }}
    >
      {LANE_ORDER.map((l) => {
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
            <span>{LANE_LABEL[l]}</span>
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
// Toolbar
// =============================================================================

function TicketsToolbar({
  total,
  open,
  producerFilter,
  setProducerFilter,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  typeOptions,
}: {
  total: number;
  open: number;
  producerFilter: string;
  setProducerFilter: (v: string) => void;
  statusFilter: 'any' | PendingActionStatus;
  setStatusFilter: (v: 'any' | PendingActionStatus) => void;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  typeOptions: string[];
}) {
  return (
    <div
      style={{
        padding: '10px 20px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {/* Keep the search-box shell for visual continuity. Phase 1 wires the
          dropdowns; free-text search lands in a later phase. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          border: '1px solid var(--line-2)',
          borderRadius: 6,
          minWidth: 220,
          background: 'var(--paper)',
          opacity: 0.5,
        }}
      >
        <Icon d={I.search} size={12} style={{ color: 'var(--ink-5)' }} />
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Filter · v2</span>
        <span style={{ flex: 1 }} />
        <span className="lp-kbd">/</span>
      </div>
      <FilterSelect
        label="status"
        value={statusFilter}
        options={STATUS_OPTIONS.map((s) => ({
          value: s,
          label: s === 'any' ? 'any' : STATUS_LABEL[s],
        }))}
        onChange={(v) => setStatusFilter(v as 'any' | PendingActionStatus)}
      />
      <FilterSelect
        label="producer"
        value={producerFilter}
        options={PRODUCER_OPTIONS.map((a) => ({ value: a, label: a }))}
        onChange={setProducerFilter}
      />
      <FilterSelect
        label="type"
        value={typeFilter}
        options={typeOptions.map((t) => ({ value: t, label: t.replace(/_/g, ' ') }))}
        onChange={setTypeFilter}
      />
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>
        {total} shown · {open} open in lane
      </span>
      <IconBtn d={I.download} title="export" />
    </div>
  );
}

// Tiny pill-shaped <select> wrapper so filters look like the existing toolbar
// pills but actually drive state. Native <select> keeps a11y + keyboard nav
// free; the pill-like shell is a CSS coat of paint.
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  const isActive = value !== 'any';
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 999,
        border: `1px solid ${isActive ? 'var(--accent)' : 'var(--line-2)'}`,
        background: isActive ? 'var(--accent-wash)' : 'var(--paper)',
        fontSize: 11,
        color: isActive ? 'var(--accent-ink)' : 'var(--ink-4)',
        cursor: 'pointer',
        fontFamily: 'var(--f-sans)',
      }}
    >
      <span style={{ opacity: 0.7 }}>{label}</span>
      <span>·</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          fontSize: 11,
          fontFamily: 'var(--f-sans)',
          outline: 'none',
          cursor: 'pointer',
          paddingRight: 2,
          maxWidth: 140,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// =============================================================================
// Table
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
const STATUS_LABEL: Record<PendingActionStatus, string> = {
  pending: 'Waiting',
  edited: 'Edited',
  applied: 'Approved',
  sent: 'Done',
  rejected: 'Dismissed',
  failed: 'Failed',
};

function TicketsTable({
  rows,
  selectedId,
  onSelect,
  loading,
  error,
  lane,
}: {
  rows: PendingAction[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  lane: ActionLane;
}) {
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
        Loading inbox…
      </div>
    );
  }
  if (rows.length === 0) {
    const emptyCopy: Record<ActionLane, string> = {
      todo: 'No active TODOs. The co-founder creates tasks when it spots something you need to do.',
      approval: 'No drafts awaiting review. Drafts queue here when the agent prepares an outreach email, monitor config, or hypothesis.',
      notification: 'No new notifications. The system posts here when it auto-refreshes a stale skill or completes a background job.',
      // monitor lane is rendered by MonitorListPanel and never falls through
      // to this empty-state path, but the Record type wants it specified.
      monitor: 'No active watchers. Click "+ New watcher" above to create one.',
    };
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
        {emptyCopy[lane]}
      </div>
    );
  }

  return (
    <div className="lp-scroll" style={{ overflow: 'auto', background: 'var(--surface)' }}>
      <div
        className="lp-mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-5)',
          padding: '9px 16px',
          display: 'grid',
          gridTemplateColumns: '64px 1fr 170px 110px 90px 50px',
          gap: 10,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          borderBottom: '1px solid var(--line)',
          background: 'var(--paper-2)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <span>id</span>
        <span>title</span>
        <span>type</span>
        <span>producer</span>
        <span>status</span>
        <span style={{ textAlign: 'right' }}>ago</span>
      </div>
      {rows.map((r) => {
        const sel = r.id === selectedId;
        const producer = producerFromType(r.action_type);
        return (
          <div
            key={r.id}
            onClick={() => onSelect(r.id)}
            style={{
              padding: '10px 16px',
              display: 'grid',
              gridTemplateColumns: '64px 1fr 170px 110px 90px 50px',
              gap: 10,
              alignItems: 'center',
              fontSize: 12,
              borderBottom: '1px solid var(--line)',
              background: sel ? 'var(--accent-wash)' : 'transparent',
              cursor: 'pointer',
            }}
          >
            <span
              className="lp-mono"
              style={{
                fontSize: 11,
                color: sel ? 'var(--accent-ink)' : 'var(--ink-4)',
                fontWeight: sel ? 600 : 400,
              }}
            >
              T-{r.id.slice(-6)}
            </span>
            <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.title}
            </span>
            <span style={{ color: 'var(--ink-4)', fontSize: 11.5 }}>
              {humanizeActionType(r.action_type)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background: producerColor(producer),
                  color: 'var(--on-accent)',
                  fontSize: 8,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                {producer.slice(0, 2).toUpperCase()}
              </span>
              <span style={{ fontSize: 11 }}>{producer}</span>
            </span>
            <Pill
              kind={STATUS_PILL[r.status] || 'n'}
              dot={r.status === 'pending' || r.status === 'applied' || r.status === 'sent'}
            >
              {STATUS_LABEL[r.status] ?? r.status}
            </Pill>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-5)', textAlign: 'right' }}>
              {timeAgo(r.created_at)}
            </span>
          </div>
        );
      })}
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
  const producer = producerFromType(action.action_type);
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
            {STATUS_LABEL[action.status] ?? action.status}
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
        <SideSection title="Brief">
          <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            {action.rationale}
          </div>
        </SideSection>
      )}

      <SideSection title={`Activity · ${buildActivity(action).length} event${buildActivity(action).length === 1 ? '' : 's'}`}>
        {buildActivity(action).map((e, i) => {
          const c = { tool: 'var(--sky)', think: 'var(--ink-5)', msg: 'var(--ink-2)', human: 'var(--accent)' }[e.k] || 'var(--ink-3)';
          return (
            <div
              key={i}
              style={{
                padding: '9px 14px',
                borderTop: '1px solid var(--line)',
                display: 'grid',
                gridTemplateColumns: '50px 60px 1fr',
                gap: 8,
                fontSize: 11.5,
              }}
            >
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{e.t}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: 3, background: c }} />
                <span style={{ fontSize: 11 }}>{e.who}</span>
              </span>
              <span
                style={{
                  color: e.k === 'think' ? 'var(--ink-4)' : 'var(--ink-2)',
                  fontStyle: e.k === 'think' ? 'italic' : 'normal',
                  fontFamily: e.k === 'tool' ? 'var(--f-mono)' : 'inherit',
                }}
              >
                {e.m}
              </span>
            </div>
          );
        })}
      </SideSection>

      {action.action_type === 'configure_monitor' ? (
        <MonitorProposalReview action={action} />
      ) : action.action_type === 'run_skill' ? (
        // Skill kickoffs SPEND credits on approval — they get a human card
        // (what you'll get / cost / duration), never a raw JSON dump.
        <SideSection title="Skill run · review">
          <SkillProposalReview action={action} />
        </SideSection>
      ) : (
        // Everything else: tidy key→value summary; full JSON behind the
        // pane's "view raw" toggle.
        <SideSection title="Details">
          <PayloadSummary payload={action.edited_payload || action.payload} />
        </SideSection>
      )}

      <SideSection title="Human actions">
        <LaneAwareActions action={action} canAct={canAct} awaitingClick={awaitingClick} onTransition={onTransition} />
      </SideSection>
    </div>
  );
}

// Lane-specific verb set. The underlying API contract is the same (transition
// verbs against /actions/[actionId]) but the labels + ordering reflect what
// the founder is actually doing in each lane:
//   TODO         → Mark done (apply) | Snooze (edit) | Dismiss (reject)
//   APPROVAL     → Apply | Reject (run_skill applies as "Run skill (≈N credits)")
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
  const lane = laneFor(action.action_type);

  if (!canAct && !awaitingClick) {
    return (
      <div style={{ padding: 14, fontSize: 11, color: 'var(--ink-5)' }}>
        Terminal state. Nothing to do here.
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
          <Icon d={I.check} size={12} /> Mark as sent
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
          <Icon d={I.check} size={12} /> Acknowledge
        </button>
        <div style={{ fontSize: 10.5, color: 'var(--ink-5)', padding: '4px 8px', lineHeight: 1.5 }}>
          Notifications older than 7 days clear automatically.
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
          <Icon d={I.check} size={12} /> Mark done
        </button>
        <button
          onClick={() => onTransition(action.id, 'reject')}
          style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--clay)' }}
        >
          <Icon d={I.stop} size={12} /> Dismiss
        </button>
      </div>
    );
  }

  // Default: approval lane (drafts, configs, workflow steps)
  // run_skill is the one approval that spends credits on apply — the button
  // says so instead of a generic "Apply". Only the LABEL changes; the
  // transition verb stays 'apply'.
  const applyLabel =
    action.action_type === 'run_skill'
      ? `Run skill (≈${skillCreditsFromAction(action)} credits)`
      : 'Apply';
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => onTransition(action.id, 'apply')}
        style={{ ...btnGhost, justifyContent: 'flex-start' }}
      >
        <Icon d={I.check} size={12} /> {applyLabel}
      </button>
      <button
        onClick={() => onTransition(action.id, 'reject')}
        style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--clay)' }}
      >
        <Icon d={I.stop} size={12} /> Reject
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
 * dump with title / objective / prompt / schedule / source URLs.
 *
 * Falls back gracefully when older proposals (pre-objective field) don't
 * carry the new payload key: derives a stand-in objective from linked_quote,
 * the same way the executor does on apply.
 */
function MonitorProposalReview({ action }: { action: PendingAction }) {
  const raw = action.edited_payload || action.payload || {};
  const p = (typeof raw === 'object' && raw !== null) ? raw as Record<string, unknown> : {};

  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

  const name = str(p.name) || action.title;
  const objective = str(p.objective) || str(p.linked_quote) || '—';
  const schedule = str(p.schedule) || 'weekly';
  const query = str(p.query);
  const urls = arr(p.urls_to_track);
  const threshold = str(p.alert_threshold);
  // Prompt is what the monitor will actually run. It's typically not on the
  // proposal payload (the executor leaves it null), so we surface the query
  // as the next-best approximation when prompt is absent.
  const prompt = str(p.prompt) || query;

  return (
    <SideSection title="Monitor proposal">
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12.5, lineHeight: 1.5 }}>
        <Field label="Title" value={name} />
        <Field label="Objective" value={objective} multiline />
        <Field label="Prompt" value={prompt || '—'} multiline mono />
        <Field label="Schedule" value={schedule} />
        {threshold && <Field label="Alert threshold" value={threshold} multiline />}
        {urls.length > 0 && (
          <div>
            <FieldLabel>Sources</FieldLabel>
            <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {urls.map((u) => (
                <li key={u} style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--ink-3)', wordBreak: 'break-all' }}>
                  <a href={u} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{u}</a>
                </li>
              ))}
            </ul>
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
// row. Truthful attribution, not persona theatre. Values match
// PRODUCER_OPTIONS so the filter dropdown round-trips cleanly.
//
// Caveat for `task`: rows can come from chat artifacts (artifact-persistence
// + project-tools), the heartbeat task proposer (cron/route.ts:204), or the
// watch source auto-task path (watch-source-processor.ts:264). The UI only
// sees action_type, so we default to the dominant producer (chat). Promoting
// this to per-row truth requires adding a `produced_by` column to
// pending_actions and stamping it at insert.
function producerFromType(type: PendingActionType): string {
  const map: Record<PendingActionType, string> = {
    draft_email: 'Outreach',
    draft_linkedin_post: 'Outreach',
    draft_linkedin_dm: 'Outreach',
    proposed_hypothesis: 'Analyst',
    proposed_interview_question: 'Analyst',
    proposed_landing_copy: 'Designer',
    proposed_investor_followup: 'Chief',
    proposed_graph_update: 'Scout',
    // workflow_step: per-step row created when chat emits a workflow-card;
    // approval just flips status (no executor). Treat as "Architect" agent —
    // the chat agent proposed it as part of a multi-step plan.
    workflow_step: 'Architect',
    // configure_monitor: in-chat monitor proposal awaiting founder review.
    // Treat as "Scout" — same family as proposed_graph_update, both about
    // populating the project's observation layer.
    configure_monitor: 'Scout',
    // configure_budget: founder-facing budget cap change proposed by chat.
    // "Chief" because raising the cap is a CEO-class decision, not analytics.
    configure_budget: 'Chief',
    // configure_watch_source: in-chat watch source proposal awaiting founder
    // approval. "Scout" — same family as monitors, both about observation.
    configure_watch_source: 'Scout',
    // run_skill: founder-approved skill kickoff. "Analyst" — the skill itself
    // performs structured analytical work (market research, risk scoring, etc.)
    // and writes durable evidence (skill_completions row, section_scores).
    run_skill: 'Analyst',
    // skill_rerun_result: heartbeat-executor refreshed an analytical skill.
    // "Chief" — score-delta visibility is a CEO concern.
    skill_rerun_result: 'Chief',
    task: 'Chief',
    // Unified-inbox surface (Phase 1 consolidation). These materialize from
    // other proposal tables — the "agent" label maps to the producer system:
    // signals come from monitors (Scout), briefs from intelligence correlation
    // (Analyst), assumptions from the validation extractor (Analyst), raw
    // changes from watch_sources scraper (Scout).
    signal_alert: 'Scout',
    intelligence_brief: 'Analyst',
    assumption_review: 'Analyst',
  };
  return map[type] || 'unknown';
}

// Human-readable label per action_type. Replaces the old underscore-to-space
// `humanizeActionType` which surfaced raw schema slugs like "configure monitor".
const TYPE_LABEL: Record<PendingActionType, string> = {
  draft_email:                  'Email draft',
  draft_linkedin_post:          'LinkedIn post',
  draft_linkedin_dm:            'LinkedIn DM',
  proposed_hypothesis:          'Hypothesis',
  proposed_interview_question:  'Interview question',
  proposed_landing_copy:        'Landing copy',
  proposed_investor_followup:   'Investor follow-up',
  proposed_graph_update:        'Graph update',
  workflow_step:                'Workflow step',
  configure_monitor:            'New watcher',
  configure_budget:             'Budget change',
  configure_watch_source:       'New watcher',
  run_skill:                    'Skill kickoff',
  skill_rerun_result:           'Skill refresh',
  task:                         'TODO',
  // Unified-inbox surface (Phase 1 consolidation).
  signal_alert:                 'Signal',
  intelligence_brief:           'Brief',
  assumption_review:            'Assumption',
};

function humanizeActionType(type: PendingActionType): string {
  return TYPE_LABEL[type] ?? type.replace(/_/g, ' ');
}

function producerColor(name: string): string {
  const map: Record<string, string> = {
    chat:       'var(--plum)',
    heartbeat:  'var(--sky)',
    signal:     'var(--moss)',
    correlator: 'var(--clay)',
    unknown:    'var(--ink-3)',
  };
  return map[name] || 'var(--ink-5)';
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

interface ActivityEvent {
  t: string;
  who: string;
  k: 'tool' | 'think' | 'msg' | 'human';
  m: string;
}

function buildActivity(a: PendingAction): ActivityEvent[] {
  // Synthesize an activity log from what we know about the action. Real
  // per-event timeline would require a separate audit table (Phase 1).
  const events: ActivityEvent[] = [];
  const producer = producerFromType(a.action_type);

  events.push({
    t: timeAgo(a.created_at),
    who: producer,
    k: 'msg',
    m: `Queued ${humanizeActionType(a.action_type)}`,
  });

  if (a.edited_payload) {
    events.push({
      t: timeAgo(a.updated_at),
      who: 'You',
      k: 'human',
      m: 'Edited payload before applying',
    });
  }

  if (a.status === 'applied' || a.status === 'sent') {
    events.push({
      t: a.executed_at ? timeAgo(a.executed_at) : timeAgo(a.updated_at),
      who: 'You',
      k: 'human',
      m: 'Applied',
    });
  }

  if (a.status === 'sent') {
    events.push({
      t: a.executed_at ? timeAgo(a.executed_at) : timeAgo(a.updated_at),
      who: producer,
      k: 'tool',
      m: 'Executed delivery',
    });
  }

  if (a.status === 'rejected') {
    events.push({
      t: timeAgo(a.updated_at),
      who: 'You',
      k: 'human',
      m: 'Rejected',
    });
  }

  return events.reverse();
}

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
