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
import type { PendingAction, PendingActionStatus, PendingActionType } from '@/types';

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

  const selected = actions.find(a => a.id === selectedId) || null;
  const openCount = (summary?.pending ?? 0) + (summary?.edited ?? 0);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Tickets & audit']}
        right={
          <Pill kind="n">
            {actions.length} · {openCount} open
          </Pill>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="tickets" />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TicketsToolbar total={actions.length} open={openCount} />

          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: selected ? '1fr 420px' : '1fr', minHeight: 0 }}>
            <TicketsTable
              rows={actions}
              selectedId={selectedId}
              onSelect={setSelectedId}
              loading={loading}
              error={error}
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
        ctxLabel={`ctx · ${actions.length} tickets`}
        budget={`${openCount} open`}
      />
    </div>
  );
}

// =============================================================================
// Toolbar
// =============================================================================

function TicketsToolbar({ total, open }: { total: number; open: number }) {
  return (
    <div
      style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          border: '1px solid var(--line-2)',
          borderRadius: 6,
          minWidth: 260,
          background: 'var(--paper)',
        }}
      >
        <Icon d={I.search} size={12} style={{ color: 'var(--ink-5)' }} />
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Filter tickets · agent:scout status:open …</span>
        <span style={{ flex: 1 }} />
        <span className="lp-kbd">/</span>
      </div>
      <Pill kind="n">status · any</Pill>
      <Pill kind="n">agent · any</Pill>
      <Pill kind="n">type · any</Pill>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>
        {total} total · {open} open
      </span>
      <IconBtn d={I.download} title="export" />
    </div>
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
}: {
  rows: PendingAction[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
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
        Caricamento tickets…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
        Nessun ticket ancora. Il co-founder accoda bozze quando esegue uno scan o quando gli chiedi di preparare qualcosa.
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
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {canAct && (
            <button
              onClick={() => onTransition(action.id, 'approve')}
              style={{ ...btnGhost, justifyContent: 'flex-start' }}
            >
              <Icon d={I.check} size={12} /> Approve output
            </button>
          )}
          {awaitingClick && (
            <button
              onClick={() => onTransition(action.id, 'mark_sent')}
              style={{ ...btnGhost, justifyContent: 'flex-start', color: 'var(--moss)' }}
            >
              <Icon d={I.check} size={12} /> Mark as sent
            </button>
          )}
          {canAct && (
            <button
              onClick={() => onTransition(action.id, 'reject')}
              style={{ ...btnGhost, justifyContent: 'flex-start', color: 'oklch(0.55 0.14 20)' }}
            >
              <Icon d={I.stop} size={12} /> Cancel
            </button>
          )}
          {!canAct && !awaitingClick && (
            <div style={{ fontSize: 11, color: 'var(--ink-5)', padding: 8 }}>
              Terminal state. Nothing to do here.
            </div>
          )}
        </div>
      </SideSection>
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
