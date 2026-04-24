'use client';

/**
 * Org — per-project AI workforce.
 *
 * Each project owns persistent agent rows in the `agents` table (seeded with
 * 5 defaults on project creation: Chief / Scout / Outreach / Analyst /
 * Designer). The founder can rename, retire, or hire new agents from this
 * page.
 *
 * Live signals are still computed client-side by joining each agent's
 * stored `monitor_types` / `action_types` / `cost_step_prefixes` against
 * the existing endpoints:
 *   - /api/projects/{id}/agents          → identity (name, role, model, caps, filters)
 *   - /api/dashboard/{id}                → monitors[].last_run for heartbeat
 *   - /api/projects/{id}/actions         → pending_actions for ticket counts
 *   - /api/projects/{id}/usage/groups    → llm_usage_logs for budget_used
 *   - /api/journey/{id}                  → milestones for the goal tree
 *
 * Refresh is event-driven — listens for `lp-tasks-changed` and
 * `lp-agents-changed` so chat-side mutations propagate without a hard reload.
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import api from '@/api';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import type { ApiResponse } from '@/types';

interface MonitorRow {
  id: string;
  type: string;
  name: string;
  status: string;
  last_run: string | null;
}

interface PendingActionRow {
  id: string;
  action_type: string;
  status: string;
}

interface UsageGroup {
  step: string | null;
  provider: string;
  model: string;
  total_cost_usd: number;
  call_count: number;
}

interface Milestone {
  id?: string;
  milestone_id?: string;
  week: number;
  title: string;
  description?: string;
  status: string;
  phase?: string;
}

interface DashboardResp {
  monitors?: MonitorRow[];
  pending_decisions?: PendingActionRow[];
}

interface AgentRecord {
  id: string;
  project_id: string;
  role: string;
  name: string;
  title: string | null;
  model: string | null;
  status: 'active' | 'retired' | 'placeholder';
  budget_cap_usd: number;
  monitor_types: string[];
  action_types: string[];
  cost_step_prefixes: string[];
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRow extends AgentRecord {
  // Computed live signals
  heart: string | null;
  liveStatus: 'live' | 'idle' | 'placeholder';
  budget_used: number;
  tickets: number;
}

export default function OrgPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const [agentRecords, setAgentRecords] = useState<AgentRecord[]>([]);
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);
  const [actions, setActions] = useState<PendingActionRow[]>([]);
  const [usage, setUsage] = useState<UsageGroup[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHire, setShowHire] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [agentsRes, dash, actionsRes, usageRes, journey] = await Promise.all([
        fetch(`/api/projects/${projectId}/agents`).then(r => r.json() as Promise<{ agents?: AgentRecord[]; error?: string }>),
        fetch(`/api/dashboard/${projectId}`).then(r => r.json() as Promise<ApiResponse<DashboardResp>>),
        fetch(`/api/projects/${projectId}/actions?limit=200`).then(r => r.json() as Promise<ApiResponse<{ actions: PendingActionRow[] }>>),
        fetch(`/api/projects/${projectId}/usage/groups`).then(r => r.json() as Promise<ApiResponse<UsageGroup[]>>).catch(() => ({ success: true, data: [] as UsageGroup[] })),
        api.get<ApiResponse<{ milestones?: Milestone[] }>>(`/api/journey/${projectId}`).catch(() => ({ data: { success: true, data: { milestones: [] } } })),
      ]);
      setAgentRecords(agentsRes.agents || []);
      setMonitors(dash.data?.monitors || []);
      setActions(actionsRes.data?.actions || []);
      setUsage(usageRes.data || []);
      const ms = (journey.data as ApiResponse<{ milestones?: Milestone[] }> | undefined)?.data?.milestones;
      setMilestones(Array.isArray(ms) ? ms : []);
    } catch { /* empty state */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Refresh on cross-page events. Chat dispatches `lp-tasks-changed` after
  // any pending_actions mutation; the new `lp-agents-changed` lets future
  // chat tools (hire/retire) trigger a refresh without a full reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => { fetchAll(); };
    window.addEventListener('lp-tasks-changed', handler);
    window.addEventListener('lp-agents-changed', handler);
    window.addEventListener('lp-data-changed', handler);
    return () => {
      window.removeEventListener('lp-tasks-changed', handler);
      window.removeEventListener('lp-agents-changed', handler);
      window.removeEventListener('lp-data-changed', handler);
    };
  }, [fetchAll]);

  // Overlay live signals on top of stored agent identity.
  const agents = useMemo<AgentRow[]>(() => {
    const lastRunFor = (types: string[]): string | null => {
      if (types.length === 0) return null;
      const runs = monitors
        .filter(m => types.some(t => m.type.startsWith(t)))
        .map(m => m.last_run)
        .filter((x): x is string => !!x);
      return runs.sort().pop() || null;
    };

    const ticketsFor = (types: string[]): number =>
      types.length === 0 ? 0 : actions.filter(a => types.includes(a.action_type)).length;

    const costFor = (prefixes: string[]): number => {
      if (prefixes.length === 0) return 0;
      let total = 0;
      for (const u of usage) {
        if (prefixes.some(p => (u.step || '').startsWith(p))) total += u.total_cost_usd;
      }
      return total;
    };

    const heartLabel = (iso: string | null): string | null => {
      if (!iso) return null;
      const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
      if (mins < 1) return 'now';
      if (mins < 60) return `${mins}m ago`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24) return `${hrs}h ago`;
      return `${Math.floor(hrs / 24)}d ago`;
    };

    const isLive = (iso: string | null): boolean => {
      if (!iso) return false;
      return Date.now() - new Date(iso).getTime() < 15 * 60 * 1000;
    };

    return agentRecords
      .filter(a => a.status !== 'retired')
      .map((a): AgentRow => {
        const last = lastRunFor(a.monitor_types);
        const tickets = ticketsFor(a.action_types);
        const cost = costFor(a.cost_step_prefixes);

        let liveStatus: 'live' | 'idle' | 'placeholder' = a.status === 'placeholder' ? 'placeholder' : 'idle';
        if (isLive(last)) liveStatus = 'live';
        else if (tickets > 0) liveStatus = 'live';
        else if (a.status === 'placeholder') liveStatus = 'placeholder';

        return {
          ...a,
          heart: heartLabel(last),
          liveStatus,
          budget_used: cost,
          tickets,
        };
      });
  }, [agentRecords, monitors, actions, usage]);

  const liveCount = agents.filter(a => a.liveStatus === 'live').length;

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Org · agents & goals']}
        right={<Pill kind="ok" dot>{agents.length} agents · {liveCount} active</Pill>}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="org" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div
            style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--surface)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 24,
            }}
          >
            <div>
              <div
                className="lp-mono"
                style={{
                  fontSize: 10,
                  color: 'var(--ink-5)',
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                company · org chart
              </div>
              <h1 className="lp-serif" style={{ fontSize: 28, margin: 0, lineHeight: 1.1 }}>
                Your AI workforce
              </h1>
              <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
                Persistent per-project agents · heartbeats follow scan schedule · budgets track llm_usage_logs.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowHire(true)}
              className="lp-mono"
              style={{
                fontSize: 11,
                padding: '7px 12px',
                borderRadius: 5,
                border: '1px solid var(--line)',
                background: 'var(--paper)',
                color: 'var(--ink-2)',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              + Hire agent
            </button>
          </div>
          <div
            className="lp-scroll"
            style={{
              flex: 1,
              overflow: 'auto',
              padding: 24,
              display: 'grid',
              gridTemplateColumns: '1.2fr 1fr',
              gap: 20,
            }}
          >
            <OrgChart
              agents={agents}
              loading={loading}
              onUpdated={fetchAll}
              projectId={projectId}
            />
            <GoalTree milestones={milestones} />
          </div>
        </div>
      </div>
      <StatusBar
        heartbeatLabel={`workforce · ${liveCount}/${agents.length} live`}
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${monitors.length} monitors`}
        budget={`tickets · ${actions.length} total`}
      />

      {showHire && (
        <HireAgentModal
          projectId={projectId}
          onClose={() => setShowHire(false)}
          onCreated={() => { setShowHire(false); fetchAll(); }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Org chart
// =============================================================================

function OrgChart({
  agents,
  loading,
  onUpdated,
  projectId,
}: {
  agents: AgentRow[];
  loading: boolean;
  onUpdated: () => void;
  projectId: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="lp-card">
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Roster</span>
        <span style={{ fontSize: 11, color: 'var(--ink-5)' }}>heartbeat interval · weekly</span>
      </div>

      {/* Visual org tree */}
      <div
        style={{
          padding: 20,
          paddingBottom: 14,
          background: 'var(--paper)',
          borderBottom: '1px solid var(--line)',
        }}
      >
        <svg viewBox="0 0 480 180" style={{ width: '100%', height: 180 }}>
          <path
            d="M240 40 v30 M240 70 H60 V100 M240 70 H160 V100 M240 70 H240 V100 M240 70 H340 V100 M240 70 H440 V100"
            stroke="var(--ink-5)"
            strokeWidth="0.6"
            fill="none"
            opacity="0.6"
          />
          {agents.slice(0, 6).map((a, i) => {
            const positions = [240, 60, 160, 240, 340, 440];
            const cx = i === 0 ? 240 : positions[Math.min(i, 5)];
            const cy = i === 0 ? 26 : 118;
            return (
              <AgentNode
                key={a.id}
                cx={cx}
                cy={cy}
                name={a.name}
                role={a.title || a.role}
                status={a.liveStatus}
                hub={i === 0}
              />
            );
          })}
        </svg>
      </div>

      {/* Roster table */}
      <div
        className="lp-mono"
        style={{
          fontSize: 10,
          color: 'var(--ink-5)',
          padding: '8px 14px',
          display: 'grid',
          gridTemplateColumns: '1.4fr 1fr 90px 80px 80px 60px 30px',
          gap: 12,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          borderBottom: '1px solid var(--line)',
        }}
      >
        <span>agent</span>
        <span>model</span>
        <span>heartbeat</span>
        <span>status</span>
        <span>budget</span>
        <span>tickets</span>
        <span></span>
      </div>

      {loading && agents.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--ink-5)' }}>
          Loading roster…
        </div>
      ) : agents.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--ink-5)' }}>
          No agents on this project yet. Hire one to get started.
        </div>
      ) : (
        agents.map((a, i) => (
          <div
            key={a.id}
            style={{
              padding: '10px 14px',
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 90px 80px 80px 60px 30px',
              gap: 12,
              alignItems: 'center',
              fontSize: 12,
              borderBottom: i < agents.length - 1 ? '1px solid var(--line)' : 'none',
              opacity: a.liveStatus === 'placeholder' ? 0.55 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  background: a.liveStatus === 'placeholder' ? 'transparent' : agentColor(a.role, a.name),
                  border: a.liveStatus === 'placeholder' ? '1px dashed var(--ink-6)' : 'none',
                  color: a.liveStatus === 'placeholder' ? 'var(--ink-5)' : '#fff',
                  fontSize: 10,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--f-mono)',
                }}
              >
                {a.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <div style={{ fontWeight: 500 }}>{a.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{a.title || a.role}</div>
              </div>
            </div>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {a.model || '—'}
            </span>
            <span
              className="lp-mono"
              style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {a.liveStatus === 'live' && (
                <span className="lp-dot lp-pulse" style={{ background: 'var(--moss)' }} />
              )}
              {a.heart || '—'}
            </span>
            <Pill kind={a.liveStatus === 'live' ? 'ok' : 'n'} dot={a.liveStatus === 'live'}>
              {a.liveStatus}
            </Pill>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  width: 50,
                  height: 3,
                  background: 'var(--line-2)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, (a.budget_used / Math.max(0.01, a.budget_cap_usd)) * 100)}%`,
                    height: '100%',
                    background: 'var(--ink-3)',
                  }}
                />
              </div>
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                ${a.budget_used.toFixed(3)}
              </span>
            </div>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {a.tickets}
            </span>
            <button
              type="button"
              onClick={() => setEditingId(a.id)}
              title="Edit agent"
              style={{
                fontSize: 11,
                width: 24,
                height: 24,
                border: '1px solid var(--line)',
                borderRadius: 4,
                background: 'transparent',
                color: 'var(--ink-4)',
                cursor: 'pointer',
              }}
            >
              ⋯
            </button>
          </div>
        ))
      )}

      {editingId && (
        <EditAgentModal
          projectId={projectId}
          agent={agents.find(a => a.id === editingId)!}
          onClose={() => setEditingId(null)}
          onSaved={() => { setEditingId(null); onUpdated(); }}
          onRetired={() => { setEditingId(null); onUpdated(); }}
        />
      )}
    </div>
  );
}

function AgentNode({
  cx,
  cy,
  name,
  role,
  status,
  hub,
}: {
  cx: number;
  cy: number;
  name: string;
  role: string;
  status: 'live' | 'idle' | 'placeholder';
  hub?: boolean;
}) {
  const placeholder = status === 'placeholder';
  const color = placeholder ? 'var(--ink-6)' : agentColor(role, name);
  return (
    <g>
      {status === 'live' && (
        <circle cx={cx} cy={cy} r={22} fill={color} opacity="0.15">
          <animate attributeName="r" values="16;24;16" dur="2.2s" repeatCount="indefinite" />
        </circle>
      )}
      <rect
        x={cx - 30}
        y={cy - 14}
        width={60}
        height={28}
        rx={14}
        fill={placeholder ? 'transparent' : color}
        stroke={placeholder ? 'var(--ink-6)' : 'none'}
        strokeDasharray={placeholder ? '3 3' : '0'}
      />
      <text
        x={cx}
        y={cy - 1}
        fontSize="10.5"
        fontWeight={600}
        fill={placeholder ? 'var(--ink-5)' : '#fff'}
        textAnchor="middle"
      >
        {name.slice(0, 8)}
      </text>
      <text
        x={cx}
        y={cy + 10}
        fontSize="8.5"
        fill={placeholder ? 'var(--ink-5)' : 'rgba(255,255,255,.7)'}
        textAnchor="middle"
        fontFamily="var(--f-mono)"
        letterSpacing=".5"
      >
        {role.toUpperCase().slice(0, 8)}
      </text>
      {hub && (
        <text
          x={cx}
          y={cy - 20}
          fontSize="8.5"
          fill="var(--ink-5)"
          textAnchor="middle"
          fontFamily="var(--f-mono)"
          letterSpacing=".5"
        >
          HUB
        </text>
      )}
    </g>
  );
}

// =============================================================================
// Hire / Edit modals
// =============================================================================

function HireAgentModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [role, setRole] = useState('');
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState('sonnet-4');
  const [budgetCap, setBudgetCap] = useState('0.10');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!role.trim() || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: role.trim(),
          name: name.trim(),
          title: title.trim() || null,
          model: model.trim() || null,
          budget_cap_usd: parseFloat(budgetCap) || 0.10,
          description: description.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Hire failed (${res.status})`);
        return;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-agents-changed', { detail: { projectId } }));
      }
      onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Hire agent">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <FieldRow label="Role slug" hint="lowercase, used as a stable id (e.g. 'biz_dev')">
          <input value={role} onChange={e => setRole(e.target.value)} required maxLength={40} />
        </FieldRow>
        <FieldRow label="Name" hint="Display name (e.g. 'Biz')">
          <input value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
        </FieldRow>
        <FieldRow label="Title" hint="e.g. 'BD lead'">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} />
        </FieldRow>
        <FieldRow label="Model" hint="e.g. 'sonnet-4', 'claude-opus-4.7'">
          <input value={model} onChange={e => setModel(e.target.value)} maxLength={80} />
        </FieldRow>
        <FieldRow label="Monthly budget cap (USD)" hint="Soft cap shown on the roster bar">
          <input type="number" step="0.01" min="0" value={budgetCap} onChange={e => setBudgetCap(e.target.value)} />
        </FieldRow>
        <FieldRow label="Description" hint="Short purpose blurb">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </FieldRow>

        {error && <div style={{ fontSize: 12, color: 'var(--alert)' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={submitting} style={btnPrimary}>
            {submitting ? 'Hiring…' : 'Hire'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditAgentModal({
  projectId,
  agent,
  onClose,
  onSaved,
  onRetired,
}: {
  projectId: string;
  agent: AgentRow;
  onClose: () => void;
  onSaved: () => void;
  onRetired: () => void;
}) {
  const [name, setName] = useState(agent.name);
  const [title, setTitle] = useState(agent.title ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const [budgetCap, setBudgetCap] = useState(String(agent.budget_cap_usd ?? 0.10));
  const [description, setDescription] = useState(agent.description ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          title: title.trim() || null,
          model: model.trim() || null,
          budget_cap_usd: parseFloat(budgetCap) || agent.budget_cap_usd,
          description: description.trim() || null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `Save failed (${res.status})`);
        return;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-agents-changed', { detail: { projectId } }));
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function retire() {
    if (!confirm(`Retire ${agent.name}? Historical activity stays attributable.`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/agents/${agent.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || `Retire failed (${res.status})`);
        return;
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('lp-agents-changed', { detail: { projectId } }));
      }
      onRetired();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Edit · ${agent.name}`}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--ink-5)' }} className="lp-mono">
          role · {agent.role}
        </div>
        <FieldRow label="Name">
          <input value={name} onChange={e => setName(e.target.value)} required maxLength={80} />
        </FieldRow>
        <FieldRow label="Title">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={80} />
        </FieldRow>
        <FieldRow label="Model">
          <input value={model} onChange={e => setModel(e.target.value)} maxLength={80} />
        </FieldRow>
        <FieldRow label="Monthly budget cap (USD)">
          <input type="number" step="0.01" min="0" value={budgetCap} onChange={e => setBudgetCap(e.target.value)} />
        </FieldRow>
        <FieldRow label="Description">
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </FieldRow>

        {error && <div style={{ fontSize: 12, color: 'var(--alert)' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" onClick={retire} disabled={submitting} style={btnDanger}>
            Retire
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} style={btnGhost}>Cancel</button>
            <button type="submit" disabled={submitting} style={btnPrimary}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function ModalShell({ children, title, onClose }: { children: React.ReactNode; title: string; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="lp-card"
        style={{
          width: 'min(92vw, 420px)',
          padding: 16,
          background: 'var(--surface)',
          maxHeight: '90vh', overflow: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 className="lp-serif" style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--ink-4)', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 600 }}>{label}</span>
      {hint && <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>{hint}</span>}
      <span
        style={{ display: 'flex' }}
        onClickCapture={(e) => {
          // Pass through; child input takes focus.
          void e;
        }}
      >
        {children}
      </span>
      <style jsx>{`
        label > span > input,
        label > span > textarea {
          width: 100%;
          padding: 6px 8px;
          font-size: 12px;
          background: var(--paper);
          border: 1px solid var(--line);
          border-radius: 4px;
          color: var(--ink-2);
          font-family: inherit;
        }
      `}</style>
    </label>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '7px 12px', fontSize: 11, borderRadius: 4,
  background: 'var(--ink-2)', color: 'var(--paper)',
  border: 'none', cursor: 'pointer',
  textTransform: 'uppercase', letterSpacing: 0.5,
  fontFamily: 'var(--f-mono)',
};
const btnGhost: React.CSSProperties = {
  padding: '7px 12px', fontSize: 11, borderRadius: 4,
  background: 'transparent', color: 'var(--ink-3)',
  border: '1px solid var(--line)', cursor: 'pointer',
  textTransform: 'uppercase', letterSpacing: 0.5,
  fontFamily: 'var(--f-mono)',
};
const btnDanger: React.CSSProperties = {
  padding: '7px 12px', fontSize: 11, borderRadius: 4,
  background: 'transparent', color: 'var(--alert, #c54)',
  border: '1px solid var(--alert, #c54)', cursor: 'pointer',
  textTransform: 'uppercase', letterSpacing: 0.5,
  fontFamily: 'var(--f-mono)',
};

// =============================================================================
// Goal tree (from milestones)
// =============================================================================

function GoalTree({ milestones }: { milestones: Milestone[] }) {
  const active = milestones.filter(m => m.status !== 'completed' && m.status !== 'skipped');
  const byPhase: Record<string, Milestone[]> = {};
  for (const m of milestones) {
    const key = m.phase || 'Roadmap';
    (byPhase[key] ||= []).push(m);
  }

  return (
    <div className="lp-card">
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Goal ancestry</span>
        <Pill kind="info">{active.length} active</Pill>
      </div>
      <div style={{ padding: 16 }}>
        {milestones.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: 12, textAlign: 'center' }}>
            No milestones set. Goals define what the workforce is working toward.
          </div>
        ) : (
          Object.entries(byPhase).map(([phase, items]) => (
            <div key={phase}>
              <GoalRow
                depth={0}
                title={phase}
                sub={`${items.length} milestone${items.length === 1 ? '' : 's'}`}
                progress={progressFromItems(items)}
                owner="Chief"
                status="active"
              />
              {items.slice(0, 6).map((m, i) => (
                <GoalRow
                  key={m.id || m.milestone_id || i}
                  depth={1}
                  title={m.title}
                  sub={`W${m.week}`}
                  progress={milestoneProgress(m)}
                  owner="—"
                  status={m.status === 'completed' ? 'done' : m.status === 'in_progress' ? 'active' : 'queued'}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function milestoneProgress(m: Milestone): number {
  if (m.status === 'completed') return 1;
  if (m.status === 'in_progress') return 0.5;
  return 0;
}

function progressFromItems(items: Milestone[]): number {
  if (items.length === 0) return 0;
  const total = items.reduce((sum, m) => sum + milestoneProgress(m), 0);
  return total / items.length;
}

function GoalRow({
  depth = 0,
  title,
  sub,
  progress,
  owner,
  status,
  icon,
}: {
  depth?: number;
  title: string;
  sub?: string;
  progress: number;
  owner: string;
  status: 'active' | 'review' | 'queued' | 'done';
  icon?: string;
}) {
  const pad = depth * 20;
  const statusMap: Record<string, 'live' | 'info' | 'n' | 'ok'> = {
    active: 'live',
    review: 'info',
    queued: 'n',
    done: 'ok',
  };
  return (
    <div style={{ position: 'relative', paddingLeft: pad, paddingBottom: 10 }}>
      {depth > 0 && (
        <span
          style={{
            position: 'absolute',
            left: pad - 10,
            top: 0,
            bottom: 10,
            width: 1,
            background: 'var(--line-2)',
          }}
        />
      )}
      {depth > 0 && (
        <span
          style={{
            position: 'absolute',
            left: pad - 10,
            top: 10,
            width: 10,
            height: 1,
            background: 'var(--line-2)',
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'flex-start',
          padding: '6px 8px',
          borderRadius: 6,
          background: depth === 0 ? 'var(--paper-2)' : 'transparent',
        }}
      >
        {depth === 0 && (
          <Icon d={icon || I.flag} size={12} style={{ color: 'var(--accent)', marginTop: 2 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: depth === 0 ? 600 : 500, color: 'var(--ink-2)' }}>
            {title}
          </div>
          {sub && (
            <div
              className="lp-mono"
              style={{
                fontSize: 10,
                color: 'var(--ink-5)',
                marginTop: 2,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}
            >
              {sub}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
            <div
              style={{
                width: 80,
                height: 3,
                background: 'var(--line-2)',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progress * 100}%`,
                  height: '100%',
                  background: progress > 0.8 ? 'var(--moss)' : 'var(--accent)',
                }}
              />
            </div>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-4)' }}>
              {Math.round(progress * 100)}%
            </span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              · {owner}
            </span>
            <span style={{ flex: 1 }} />
            <Pill kind={statusMap[status]} dot={status !== 'queued' && status !== 'done'}>
              {status}
            </Pill>
          </div>
        </div>
      </div>
    </div>
  );
}

// Stable color per role slug (with a fallback for custom hires).
function agentColor(role: string, name: string): string {
  const map: Record<string, string> = {
    chief: '#4a5a7a',
    scout: '#7a8b4a',
    outreach: '#7a4a6a',
    analyst: '#7a5a4a',
    designer: '#4a7a7a',
  };
  if (map[role]) return map[role];
  // Hash the name for a deterministic muted color when a founder hires custom.
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 25%, 38%)`;
}
