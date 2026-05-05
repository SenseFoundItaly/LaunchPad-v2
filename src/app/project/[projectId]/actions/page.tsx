'use client';

/**
 * Tickets & Audit — ported from screen-tickets.jsx.
 *
 * Linear-style table on the left, selected-ticket detail panel on the right.
 * Every pending_action is a ticket — inspectable, approvable, rejectable.
 *
 * Data shape is derived client-side from /api/projects/{id}/actions:
 *   - agent     ← derived from action_type (src/lib/agent-synthesis.ts)
 *   - goal      ← first clause of rationale or —
 *   - progress  ← status → [0, 30%, 60%, 100%, 0%, 50%]
 *   - cost      ← "—" for now (per-ticket cost would need a new JOIN endpoint)
 *   - ago       ← humanized created_at
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import { TopBar, NavRail } from '@/components/design/chrome';
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
};
const LANE_ORDER: ActionLane[] = ['todo', 'approval', 'notification'];

const AGENT_OPTIONS = ['any', 'Scout', 'Chief', 'Analyst', 'Outreach', 'Designer', 'Architect'] as const;
const STATUS_OPTIONS: Array<'any' | PendingActionStatus> = ['any', 'pending', 'edited', 'approved', 'sent', 'rejected', 'failed'];

// =============================================================================
// Page
// =============================================================================

interface InboxSummary {
  pending: number;
  edited: number;
  approved_awaiting_send: number;
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

  const [actions, setActions] = useState<PendingAction[]>([]);
  const [summary, setSummary] = useState<InboxSummary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lane tab + filter dropdowns. Default lane is chosen after first fetch
  // based on whichever lane has the most open rows (so a founder with 12
  // approvals and 0 TODOs lands on Approvals first). Filters default to 'any'
  // so the list matches the pre-Phase-1 behaviour until the founder narrows.
  const [lane, setLane] = useState<ActionLane>('todo');
  const [laneInitialized, setLaneInitialized] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>('any');
  const [statusFilter, setStatusFilter] = useState<'any' | PendingActionStatus>('any');
  const [typeFilter, setTypeFilter] = useState<string>('any');

  const fetchAll = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/actions?status=pending,edited,approved,rejected,sent,failed&limit=200`);
      const body: InboxResponse = await res.json();
      if (!body.success || !body.data) throw new Error(body.error || 'Fetch failed');
      setActions(body.data.actions);
      setSummary(body.data.summary);
      // Keep selection if still in list; else pick first
      if (selectedId && !body.data.actions.find(a => a.id === selectedId)) {
        setSelectedId(body.data.actions[0]?.id || null);
      } else if (!selectedId && body.data.actions.length > 0) {
        setSelectedId(body.data.actions[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Lane counts for the tab strip — only OPEN rows count (pending+edited),
  // matching what the footer's `openCount` already tracks. Terminal-state
  // rows still appear in the list if the dropdown filter allows, but the
  // tab badge shouldn't scream "12!" when 11 of those are already sent.
  const laneCounts = useMemo<Record<ActionLane, number>>(() => {
    const c: Record<ActionLane, number> = { todo: 0, approval: 0, notification: 0 };
    for (const a of actions) {
      if (a.status === 'pending' || a.status === 'edited') {
        c[laneFor(a.action_type)]++;
      }
    }
    return c;
  }, [actions]);

  // After the first successful fetch, pick the lane with the highest open
  // count so the founder lands where the work is. Tie-breaker: TODOs.
  useEffect(() => {
    if (laneInitialized || loading) return;
    const winner = LANE_ORDER.reduce<ActionLane>(
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
      if (agentFilter !== 'any' && agentFromType(a.action_type) !== agentFilter) return false;
      return true;
    });
  }, [actions, lane, statusFilter, typeFilter, agentFilter]);

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
    setAgentFilter('any');
    setStatusFilter('any');
    setTypeFilter('any');
  }

  async function transition(actionId: string, verb: 'approve' | 'reject' | 'mark_sent', extras: Record<string, unknown> = {}) {
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
      await fetchAll();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selected = filteredActions.find(a => a.id === selectedId) || null;
  const openCount = (summary?.pending ?? 0) + (summary?.edited ?? 0);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Inbox']}
        right={
          <Pill kind="n">
            {actions.length} · {openCount} open
          </Pill>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="tickets" />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <LaneTabs
            active={lane}
            counts={laneCounts}
            onChange={handleLaneChange}
          />
          <TicketsToolbar
            total={filteredActions.length}
            open={laneCounts[lane]}
            agentFilter={agentFilter}
            setAgentFilter={setAgentFilter}
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
  agentFilter,
  setAgentFilter,
  statusFilter,
  setStatusFilter,
  typeFilter,
  setTypeFilter,
  typeOptions,
}: {
  total: number;
  open: number;
  agentFilter: string;
  setAgentFilter: (v: string) => void;
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
        options={STATUS_OPTIONS.map((s) => ({ value: s, label: s }))}
        onChange={(v) => setStatusFilter(v as 'any' | PendingActionStatus)}
      />
      <FilterSelect
        label="agent"
        value={agentFilter}
        options={AGENT_OPTIONS.map((a) => ({ value: a, label: a }))}
        onChange={setAgentFilter}
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
  approved: 'ok',
  sent: 'ok',
  rejected: 'n',
  failed: 'warn',
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
      approval: 'No drafts awaiting approval. Drafts queue here when the agent prepares an outreach email, monitor config, or hypothesis.',
      notification: 'No new notifications. The system posts here when it auto-refreshes a stale skill or completes a background job.',
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
          gridTemplateColumns: '64px 1fr 170px 110px 90px 110px 70px 50px',
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
        <span>agent</span>
        <span>status</span>
        <span>progress</span>
        <span>impact</span>
        <span style={{ textAlign: 'right' }}>ago</span>
      </div>
      {rows.map((r) => {
        const sel = r.id === selectedId;
        const agent = agentFromType(r.action_type);
        const prog = progressFromStatus(r.status);
        return (
          <div
            key={r.id}
            onClick={() => onSelect(r.id)}
            style={{
              padding: '10px 16px',
              display: 'grid',
              gridTemplateColumns: '64px 1fr 170px 110px 90px 110px 70px 50px',
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
                  background: agentColor(agent),
                  color: '#fff',
                  fontSize: 8,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                {agent.slice(0, 2).toUpperCase()}
              </span>
              <span style={{ fontSize: 11 }}>{agent}</span>
            </span>
            <Pill
              kind={STATUS_PILL[r.status] || 'n'}
              dot={r.status === 'pending' || r.status === 'approved' || r.status === 'sent'}
            >
              {r.status}
            </Pill>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 60, height: 3, background: 'var(--line-2)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${prog * 100}%`,
                    height: '100%',
                    background:
                      r.status === 'failed' || r.status === 'rejected'
                        ? 'var(--clay)'
                        : prog === 1
                          ? 'var(--moss)'
                          : 'var(--accent)',
                  }}
                />
              </div>
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                {Math.round(prog * 100)}%
              </span>
            </div>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {r.estimated_impact || '—'}
            </span>
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
  onTransition: (id: string, verb: 'approve' | 'reject' | 'mark_sent') => Promise<void>;
}) {
  const agent = agentFromType(action.action_type);
  const canAct = action.status === 'pending' || action.status === 'edited';
  const awaitingClick = action.status === 'approved';

  return (
    <div
      className="lp-scroll"
      style={{ borderLeft: '1px solid var(--line)', overflow: 'auto', background: 'var(--surface)' }}
    >
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <Pill kind={STATUS_PILL[action.status] || 'n'} dot>
            {action.status}
          </Pill>
          <Pill kind="n">{agent}</Pill>
          {action.estimated_impact && (
            <Pill kind="n">impact · {action.estimated_impact}</Pill>
          )}
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

      <SideSection title="Payload · preview">
        <pre
          style={{
            margin: 0,
            padding: 14,
            fontSize: 10.5,
            background: 'var(--paper-2)',
            color: 'var(--ink-3)',
            fontFamily: 'var(--f-mono)',
            maxHeight: 300,
            overflow: 'auto',
            borderTop: '1px solid var(--line)',
          }}
        >
          {JSON.stringify(action.edited_payload || action.payload, null, 2)}
        </pre>
      </SideSection>

      <SideSection title="Human actions">
        <LaneAwareActions action={action} canAct={canAct} awaitingClick={awaitingClick} onTransition={onTransition} />
      </SideSection>
    </div>
  );
}

// Lane-specific verb set. The underlying API contract is the same (transition
// verbs against /actions/[actionId]) but the labels + ordering reflect what
// the founder is actually doing in each lane:
//   TODO         → Mark done (approve) | Snooze (edit) | Dismiss (reject)
//   APPROVAL     → Approve | Reject — same as before
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
  onTransition: (id: string, verb: 'approve' | 'reject' | 'mark_sent') => Promise<void>;
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
          onClick={() => onTransition(action.id, 'approve')}
          style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--moss)' }}
        >
          <Icon d={I.check} size={12} /> Mark done
        </button>
        <button
          onClick={() => onTransition(action.id, 'reject')}
          style={{ ...btnGhost, justifyContent: 'flex-start', color: 'oklch(0.55 0.14 20)' }}
        >
          <Icon d={I.stop} size={12} /> Dismiss
        </button>
      </div>
    );
  }

  // Default: approval lane (drafts, configs, workflow steps)
  return (
    <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        onClick={() => onTransition(action.id, 'approve')}
        style={{ ...btnGhost, justifyContent: 'flex-start' }}
      >
        <Icon d={I.check} size={12} /> Approve
      </button>
      <button
        onClick={() => onTransition(action.id, 'reject')}
        style={{ ...btnGhost, justifyContent: 'flex-start', color: 'oklch(0.55 0.14 20)' }}
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

// =============================================================================
// Derivation helpers (client-side)
// =============================================================================

function agentFromType(type: PendingActionType): string {
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
    // configure_monitor: in-chat monitor proposal awaiting founder approval.
    // Treat as "Scout" — same family as proposed_graph_update, both about
    // populating the project's observation layer.
    configure_monitor: 'Scout',
    // configure_budget: founder-facing budget cap change proposed by chat.
    // "Chief" because raising the cap is a CEO-class decision, not analytics.
    configure_budget: 'Chief',
    // configure_watch_source: in-chat watch source proposal awaiting founder
    // approval. "Scout" — same family as monitors, both about observation.
    configure_watch_source: 'Scout',
    // skill_rerun_result: heartbeat-executor refreshed an analytical skill.
    // "Chief" — score-delta visibility is a CEO concern.
    skill_rerun_result: 'Chief',
    task: 'Chief',
  };
  return map[type] || 'Agent';
}

function humanizeActionType(type: PendingActionType): string {
  return type.replace(/_/g, ' ');
}

function progressFromStatus(status: PendingActionStatus): number {
  const map: Record<PendingActionStatus, number> = {
    pending: 0,
    edited: 0.3,
    approved: 0.6,
    sent: 1,
    rejected: 0,
    failed: 0.5,
  };
  return map[status] ?? 0;
}

function agentColor(name: string): string {
  const map: Record<string, string> = {
    Scout: '#7a8b4a',
    Chief: '#4a5a7a',
    Analyst: '#7a5a4a',
    Outreach: '#7a4a6a',
    Designer: '#4a7a7a',
    Agent: '#6b6558',
  };
  return map[name] || '#555';
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
  const agent = agentFromType(a.action_type);

  events.push({
    t: timeAgo(a.created_at),
    who: agent,
    k: 'msg',
    m: `Queued ${humanizeActionType(a.action_type)}`,
  });

  if (a.edited_payload) {
    events.push({
      t: timeAgo(a.updated_at),
      who: 'Luca',
      k: 'human',
      m: 'Edited payload before approval',
    });
  }

  if (a.status === 'approved' || a.status === 'sent') {
    events.push({
      t: a.executed_at ? timeAgo(a.executed_at) : timeAgo(a.updated_at),
      who: 'Luca',
      k: 'human',
      m: 'Approved',
    });
  }

  if (a.status === 'sent') {
    events.push({
      t: a.executed_at ? timeAgo(a.executed_at) : timeAgo(a.updated_at),
      who: agent,
      k: 'tool',
      m: 'Executed delivery',
    });
  }

  if (a.status === 'rejected') {
    events.push({
      t: timeAgo(a.updated_at),
      who: 'Luca',
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
