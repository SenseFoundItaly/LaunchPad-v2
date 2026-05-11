'use client';

/**
 * Org — ported from screen-org.jsx.
 *
 * Synthesizes an "AI workforce" from real data. We don't have an agents
 * table in the schema (Phase 1 territory); instead we derive 4 agents from
 * monitor types + pending_actions categories:
 *
 *   Chief    ← health monitor + aggregate of all activity
 *   Scout    ← ecosystem.competitors/ip/trends monitors + proposed_graph_update actions
 *   Outreach ← ecosystem.partnerships monitor + draft_email/linkedin actions
 *   Analyst  ← proposed_hypothesis / proposed_interview_question actions
 *   Designer ← proposed_landing_copy actions (or +hire placeholder when none)
 *
 * Goal tree derives from milestones table via /api/journey/{id}.
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import api from '@/api';
import { TopBar, NavRail } from '@/components/design/chrome';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
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

interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  heart: string | null;
  status: 'live' | 'idle' | 'placeholder';
  budget_used: number;
  budget_cap: number;
  tickets: number;
}

export default function OrgPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const [monitors, setMonitors] = useState<MonitorRow[]>([]);
  const [actions, setActions] = useState<PendingActionRow[]>([]);
  const [usage, setUsage] = useState<UsageGroup[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [dash, actionsRes, usageRes, journey] = await Promise.all([
        fetch(`/api/dashboard/${projectId}`).then(r => r.json() as Promise<ApiResponse<DashboardResp>>),
        fetch(`/api/projects/${projectId}/actions?limit=200`).then(r => r.json() as Promise<ApiResponse<{ actions: PendingActionRow[] }>>),
        fetch(`/api/projects/${projectId}/usage/groups`).then(r => r.json() as Promise<ApiResponse<UsageGroup[]>>).catch(() => ({ success: true, data: [] as UsageGroup[] })),
        api.get<ApiResponse<{ milestones?: Milestone[] }>>(`/api/journey/${projectId}`).catch(() => ({ data: { success: true, data: { milestones: [] } } })),
      ]);
      setMonitors(dash.data?.monitors || []);
      setActions(actionsRes.data?.actions || []);
      setUsage(usageRes.data || []);
      const ms = (journey.data as ApiResponse<{ milestones?: Milestone[] }> | undefined)?.data?.milestones;
      setMilestones(Array.isArray(ms) ? ms : []);
    } catch { /* empty state */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Synthesize agents from real data
  const agents = useMemo<Agent[]>(() => {
    const byStep: Record<string, UsageGroup[]> = {};
    for (const u of usage) {
      const key = u.step || '';
      (byStep[key] ||= []).push(u);
    }

    const costFor = (...stepPrefixes: string[]): number => {
      let total = 0;
      for (const u of usage) {
        if (stepPrefixes.some(p => (u.step || '').startsWith(p))) total += u.total_cost_usd;
      }
      return total;
    };

    const lastRunFor = (...types: string[]): string | null => {
      const runs = monitors
        .filter(m => types.some(t => m.type.startsWith(t)))
        .map(m => m.last_run)
        .filter((x): x is string => !!x);
      return runs.sort().pop() || null;
    };

    const ticketsFor = (...types: string[]): number =>
      actions.filter(a => types.some(t => a.action_type === t)).length;

    const heartLabel = (iso: string | null): string => {
      if (!iso) return '—';
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

    return [
      {
        id: 'chief',
        name: 'Chief',
        role: 'CEO',
        model: 'claude-opus-4.1',
        heart: heartLabel(lastRunFor('health')),
        status: isLive(lastRunFor('health')) ? 'live' : 'idle',
        budget_used: costFor('health', 'manual.health'),
        budget_cap: 0.12,
        tickets: ticketsFor('proposed_investor_followup'),
      },
      {
        id: 'scout',
        name: 'Scout',
        role: 'Research',
        model: 'sonnet-4 + web',
        heart: heartLabel(lastRunFor('ecosystem.competitors', 'ecosystem.ip', 'ecosystem.trends')),
        status: isLive(lastRunFor('ecosystem.competitors', 'ecosystem.ip', 'ecosystem.trends')) ? 'live' : 'idle',
        budget_used: costFor('cron.ecosystem.competitors', 'cron.ecosystem.ip', 'cron.ecosystem.trends', 'manual.ecosystem.competitors', 'manual.ecosystem.ip', 'manual.ecosystem.trends'),
        budget_cap: 0.15,
        tickets: ticketsFor('proposed_graph_update'),
      },
      {
        id: 'outreach',
        name: 'Outreach',
        role: 'Growth',
        model: 'sonnet-4',
        heart: heartLabel(lastRunFor('ecosystem.partnerships')),
        status: isLive(lastRunFor('ecosystem.partnerships')) ? 'live' : 'idle',
        budget_used: costFor('cron.ecosystem.partnerships', 'manual.ecosystem.partnerships'),
        budget_cap: 0.10,
        tickets: ticketsFor('draft_email', 'draft_linkedin_post', 'draft_linkedin_dm'),
      },
      {
        id: 'analyst',
        name: 'Analyst',
        role: 'Data',
        model: 'sonnet-4',
        heart: null,
        status: ticketsFor('proposed_hypothesis', 'proposed_interview_question') > 0 ? 'live' : 'idle',
        budget_used: 0,
        budget_cap: 0.10,
        tickets: ticketsFor('proposed_hypothesis', 'proposed_interview_question'),
      },
      {
        id: 'design',
        name: 'Designer',
        role: 'Pitch/brand',
        model: 'sonnet-4',
        heart: null,
        status: ticketsFor('proposed_landing_copy') > 0 ? 'live' : 'placeholder',
        budget_used: 0,
        budget_cap: 0.08,
        tickets: ticketsFor('proposed_landing_copy'),
      },
    ];
  }, [monitors, actions, usage]);

  const liveCount = agents.filter(a => a.status === 'live').length;

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Org · agents & goals']}
        right={<Pill kind="ok" dot>{agents.length} agents · {liveCount} active</Pill>}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="org" inboxBadge={inboxBadge} />
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
                Synthesized from monitors + pending_actions · heartbeats follow scan schedule · budgets track llm_usage_logs.
              </div>
            </div>
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
            <OrgChart agents={agents} loading={loading} />
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
    </div>
  );
}

// =============================================================================
// Org chart
// =============================================================================

function OrgChart({ agents, loading }: { agents: Agent[]; loading: boolean }) {
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
          {agents.map((a, i) => {
            const positions = [240, 60, 160, 240, 340, 440];
            const cx = i === 0 ? 240 : positions[Math.min(i, 5)];
            const cy = i === 0 ? 26 : 118;
            return (
              <AgentNode
                key={a.id}
                cx={cx}
                cy={cy}
                name={a.name}
                role={a.role}
                status={a.status}
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
          gridTemplateColumns: '1.4fr 1fr 90px 80px 80px 60px',
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
      </div>

      {loading && agents.length === 0 ? (
        <div style={{ padding: 30, textAlign: 'center', fontSize: 12, color: 'var(--ink-5)' }}>
          Loading roster…
        </div>
      ) : (
        agents.map((a, i) => (
          <div
            key={a.id}
            style={{
              padding: '10px 14px',
              display: 'grid',
              gridTemplateColumns: '1.4fr 1fr 90px 80px 80px 60px',
              gap: 12,
              alignItems: 'center',
              fontSize: 12,
              borderBottom: i < agents.length - 1 ? '1px solid var(--line)' : 'none',
              opacity: a.status === 'placeholder' ? 0.55 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 5,
                  background: a.status === 'placeholder' ? 'transparent' : agentColor(a.name),
                  border: a.status === 'placeholder' ? '1px dashed var(--ink-6)' : 'none',
                  color: a.status === 'placeholder' ? 'var(--ink-5)' : '#fff',
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
                <div style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>{a.role}</div>
              </div>
            </div>
            <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
              {a.model}
            </span>
            <span
              className="lp-mono"
              style={{ fontSize: 11, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              {a.status === 'live' && (
                <span className="lp-dot lp-pulse" style={{ background: 'var(--moss)' }} />
              )}
              {a.heart || '—'}
            </span>
            <Pill kind={a.status === 'live' ? 'ok' : 'n'} dot={a.status === 'live'}>
              {a.status}
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
                    width: `${Math.min(100, (a.budget_used / Math.max(0.01, a.budget_cap)) * 100)}%`,
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
          </div>
        ))
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
  const color = placeholder ? 'var(--ink-6)' : agentColor(name);
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
        {name}
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
        {role.toUpperCase()}
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

function agentColor(name: string): string {
  const map: Record<string, string> = {
    Scout: '#7a8b4a',
    Chief: '#4a5a7a',
    Analyst: '#7a5a4a',
    Outreach: '#7a4a6a',
    Designer: '#4a7a7a',
  };
  return map[name] || '#555';
}
