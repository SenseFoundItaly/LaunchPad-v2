'use client';

/**
 * Workflow Run — ported from screen-pipeline.jsx.
 *
 * DAG on top, live log + sidebar split below. Reads from
 * /api/projects/{id}/workflow-run which returns the most-recent
 * workflow_plans row + tool_executions as a flat log.
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
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

interface WorkflowStep {
  title?: string;
  name?: string;
  agent?: string;
  status?: string;
  duration_est?: string;
  cost_est?: string;
  tools?: string[];
  progress?: number;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  status: string;
  current_step: number;
  created_at: string;
  updated_at: string;
}

interface Execution {
  id: string;
  workflow_run_id: string | null;
  step_index: number | null;
  tool_id: string | null;
  status: string;
  input_params: string | null;
  output: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface WorkflowResponse {
  success: boolean;
  data?: { plan: Plan | null; executions: Execution[] };
}

const STATUS_PILL: Record<string, PillKind> = {
  done: 'ok',
  completed: 'ok',
  running: 'live',
  queued: 'n',
  pending: 'n',
  failed: 'warn',
  error: 'warn',
  planned: 'n',
};

export default function WorkflowPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/workflow-run`);
      const body: WorkflowResponse = await res.json();
      if (body.success && body.data) {
        setPlan(body.data.plan);
        setExecutions(body.data.executions);
      }
    } catch { /* empty state */ }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const running = plan?.status === 'running';
  const currentIdx = plan?.current_step ?? 0;
  const totalSteps = plan?.steps?.length ?? 0;

  const costByTool = useMemo(() => {
    const acc: Record<string, { count: number }> = {};
    for (const e of executions) {
      const k = e.tool_id || 'unknown';
      acc[k] = acc[k] || { count: 0 };
      acc[k].count++;
    }
    return Object.entries(acc)
      .map(([k, v]) => ({
        k,
        v: `${v.count} call${v.count === 1 ? '' : 's'}`,
        w: Math.min(1, v.count / Math.max(1, executions.length)),
      }))
      .sort((a, b) => b.w - a.w)
      .slice(0, 6);
  }, [executions]);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Workflows', plan?.name || 'No active workflow']}
        right={
          plan ? (
            <>
              <Pill kind={STATUS_PILL[plan.status] || 'n'} dot={running}>
                {running ? `running · step ${currentIdx + 1}/${totalSteps}` : plan.status}
              </Pill>
              <span className="lp-mono" style={{ fontSize: 10 }}>
                created · {timeAgo(plan.created_at)}
              </span>
            </>
          ) : (
            <Pill kind="n">no workflow</Pill>
          )
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="pipe" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {plan ? (
            <>
              <PipelineHeader plan={plan} />
              <PipelineDag plan={plan} />
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 340px', minHeight: 0 }}>
                <PipelineLog executions={executions} />
                <PipelineSidebar plan={plan} costByTool={costByTool} />
              </div>
            </>
          ) : (
            <EmptyState loading={loading} />
          )}
        </div>
      </div>

      <StatusBar
        heartbeatLabel={plan ? `workflow · ${plan.status}` : 'heartbeat · idle'}
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${executions.length} tool calls`}
        budget={`${totalSteps} steps`}
      />
    </div>
  );
}

function EmptyState({ loading }: { loading: boolean }) {
  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-5)', fontSize: 12 }}>
        Loading workflow…
      </div>
    );
  }
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 12,
        background: 'var(--paper)',
        padding: 40,
        textAlign: 'center',
      }}
    >
      <Icon d={I.pipe} size={40} style={{ color: 'var(--ink-5)', opacity: 0.4 }} />
      <h2 className="lp-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: -0.4, margin: 0 }}>
        No workflow running.
      </h2>
      <p
        style={{
          fontSize: 13,
          color: 'var(--ink-4)',
          maxWidth: 440,
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        Workflows are multi-step DAGs that the co-pilot runs on your behalf — scrape, cluster, interview,
        score, draft. Trigger one from chat by asking the co-pilot to &quot;run a deep-dive&quot;.
      </p>
    </div>
  );
}

function PipelineHeader({ plan }: { plan: Plan }) {
  const running = plan.status === 'running';
  return (
    <div
      style={{
        padding: '16px 24px 14px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <Pill kind={STATUS_PILL[plan.status] || 'n'} dot={running}>
            {plan.status}
          </Pill>
          <Pill kind="n">{plan.steps.length} steps</Pill>
        </div>
        <h1 className="lp-serif" style={{ fontSize: 22, margin: 0, lineHeight: 1.15 }}>
          {plan.name}
        </h1>
        {plan.description && (
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>{plan.description}</div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button style={btnGhost}>
          <Icon d={I.pause} size={12} /> pause
        </button>
        <button style={btnGhost}>
          <Icon d={I.history} size={12} /> rerun
        </button>
        {running && (
          <button style={{ ...btnPrimary, background: 'oklch(0.58 0.14 20)' }}>
            <Icon d={I.stop} size={12} /> stop
          </button>
        )}
      </div>
    </div>
  );
}

function PipelineDag({ plan }: { plan: Plan }) {
  const currentIdx = plan.current_step;
  return (
    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)', background: 'var(--paper)' }}>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
        {plan.steps.map((s, i) => {
          const isRunning = i === currentIdx && plan.status === 'running';
          const isDone = i < currentIdx || (i === currentIdx && plan.status === 'completed');
          const effStatus = isRunning ? 'running' : isDone ? 'done' : 'queued';
          const kind = STATUS_PILL[effStatus] || 'n';
          return (
            <div key={i} style={{ display: 'contents' }}>
              <div
                style={{
                  flex: 1,
                  padding: 12,
                  border: '1px solid',
                  borderColor: isRunning ? 'var(--accent)' : 'var(--line-2)',
                  borderRadius: 'var(--r-m)',
                  background: isRunning ? 'var(--accent-wash)' : isDone ? 'var(--surface)' : 'var(--paper-2)',
                  boxShadow: isRunning ? '0 0 0 3px var(--accent-wash)' : 'none',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                    0{i + 1}
                  </span>
                  <Pill kind={kind} dot={effStatus === 'running' || effStatus === 'done'}>
                    {effStatus}
                  </Pill>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)', lineHeight: 1.3, minHeight: 34 }}>
                  {s.title || s.name || `Step ${i + 1}`}
                </div>
                {s.agent && (
                  <div className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', marginTop: 6 }}>
                    {s.agent.toUpperCase()}
                    {s.duration_est && ` · ${s.duration_est}`}
                    {s.cost_est && ` · ${s.cost_est}`}
                  </div>
                )}
                {s.tools && s.tools.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {s.tools.map((t) => (
                      <span
                        key={t}
                        className="lp-mono"
                        style={{
                          fontSize: 9,
                          color: 'var(--ink-4)',
                          padding: '1px 5px',
                          background: 'var(--paper-2)',
                          borderRadius: 3,
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {isRunning && s.progress !== undefined && (
                  <div
                    style={{
                      marginTop: 8,
                      height: 3,
                      borderRadius: 2,
                      background: 'rgba(255,255,255,0.6)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${s.progress * 100}%`,
                        height: '100%',
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                )}
              </div>
              {i < plan.steps.length - 1 && (
                <div
                  style={{
                    width: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isDone ? 'var(--moss)' : 'var(--ink-5)',
                  }}
                >
                  <Icon d={I.arrow} size={14} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PipelineLog({ executions }: { executions: Execution[] }) {
  if (executions.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ink-5)',
          fontSize: 12,
          padding: 40,
          borderRight: '1px solid var(--line)',
          background: 'var(--surface)',
        }}
      >
        No tool executions yet. The log populates as steps run.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRight: '1px solid var(--line)' }}>
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
          Live log · {executions.length} events
        </span>
        <Pill kind="n">all tools</Pill>
        <Pill kind="n">all statuses</Pill>
        <IconBtn d={I.download} title="export" />
      </div>
      <div className="lp-scroll" style={{ flex: 1, overflow: 'auto', background: 'var(--surface)' }}>
        {executions.map((e, i) => {
          const lvlColor =
            e.status === 'completed' ? 'var(--moss)'
              : e.status === 'failed' || e.status === 'error' ? 'var(--clay)'
              : e.status === 'running' ? 'var(--sky)'
              : 'var(--ink-4)';
          const toolName = e.tool_id || 'unknown';
          const out = e.output ? summarizeOutput(e.output) : e.error || null;
          return (
            <div
              key={e.id}
              style={{
                padding: '10px 16px',
                borderBottom: i < executions.length - 1 ? '1px solid var(--line)' : 'none',
                display: 'grid',
                gridTemplateColumns: '78px 80px 54px 1fr',
                gap: 10,
                fontSize: 12,
                alignItems: 'start',
              }}
            >
              <span className="lp-mono" style={{ fontSize: 10.5, color: 'var(--ink-5)' }}>
                {formatTime(e.started_at || e.created_at)}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: 'var(--ink-4)',
                    color: '#fff',
                    fontSize: 8,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'var(--f-mono)',
                  }}
                >
                  {String(e.step_index ?? '—').padStart(2, '0')}
                </span>
                <span style={{ fontSize: 11 }}>step {e.step_index ?? '—'}</span>
              </span>
              <span
                className="lp-mono"
                style={{
                  fontSize: 10,
                  color: lvlColor,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {e.status}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink-2)', fontFamily: 'var(--f-mono)', fontSize: 11.5 }}>
                  {toolName}
                </div>
                {out && (
                  <div
                    className="lp-mono"
                    style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 2 }}
                  >
                    ↳ {out}
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

function PipelineSidebar({
  plan,
  costByTool,
}: {
  plan: Plan;
  costByTool: Array<{ k: string; v: string; w: number }>;
}) {
  const currentStep = plan.steps[plan.current_step];
  const pct = plan.steps.length > 0 ? (plan.current_step / plan.steps.length) * 100 : 0;

  return (
    <div className="lp-scroll" style={{ overflow: 'auto', background: 'var(--surface)' }}>
      <SideSection title="Current step">
        <div style={{ padding: 14 }}>
          <div
            className="lp-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-5)',
              textTransform: 'uppercase',
              letterSpacing: 0.4,
              marginBottom: 4,
            }}
          >
            Step {String(plan.current_step + 1).padStart(2, '0')}
            {currentStep?.agent && ` · ${currentStep.agent}`}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>
            {currentStep?.title || currentStep?.name || '—'}
          </div>
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                marginBottom: 4,
              }}
            >
              <span style={{ color: 'var(--ink-4)' }}>
                Progress · {plan.current_step}/{plan.steps.length} steps
              </span>
              <span className="lp-mono" style={{ color: 'var(--ink-3)' }}>
                {pct.toFixed(0)}%
              </span>
            </div>
            <div
              style={{
                height: 4,
                borderRadius: 2,
                background: 'var(--line-2)',
                overflow: 'hidden',
              }}
            >
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
          </div>
        </div>
      </SideSection>

      <SideSection title="Tool breakdown">
        <div style={{ padding: 14 }}>
          {costByTool.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--ink-5)' }}>No tool executions yet.</div>
          ) : (
            costByTool.map((r) => (
              <div
                key={r.k}
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 11.5 }}
              >
                <span
                  style={{
                    flex: 1,
                    color: 'var(--ink-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.k}
                </span>
                <div style={{ width: 40, height: 3, background: 'var(--line-2)', borderRadius: 2 }}>
                  <div style={{ width: `${r.w * 100}%`, height: '100%', background: 'var(--ink-3)' }} />
                </div>
                <span
                  className="lp-mono"
                  style={{ fontSize: 10.5, color: 'var(--ink-4)', minWidth: 60, textAlign: 'right' }}
                >
                  {r.v}
                </span>
              </div>
            ))
          )}
        </div>
      </SideSection>

      <SideSection title="Trigger">
        <div style={{ padding: 14, fontSize: 11.5, color: 'var(--ink-3)' }}>
          <div>Manual · {timeAgo(plan.created_at)} ago</div>
          <div
            className="lp-mono"
            style={{ fontSize: 10.5, color: 'var(--ink-5)', marginTop: 4 }}
          >
            /workflow run {plan.name.toLowerCase().replace(/\s+/g, '-')}
          </div>
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
          padding: '9px 14px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--paper-2)',
        }}
      >
        <span
          className="lp-mono"
          style={{
            fontSize: 10,
            color: 'var(--ink-4)',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            fontWeight: 600,
          }}
        >
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function summarizeOutput(raw: string): string {
  try {
    const p = JSON.parse(raw);
    if (typeof p === 'object' && p !== null) {
      const keys = Object.keys(p as Record<string, unknown>).slice(0, 3);
      return keys.length > 0
        ? keys.map((k) => `${k}=${JSON.stringify((p as Record<string, unknown>)[k]).slice(0, 30)}`).join(' · ')
        : '(empty)';
    }
    return String(p).slice(0, 80);
  } catch {
    return raw.slice(0, 80);
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  } catch {
    return iso.slice(11, 19);
  }
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
    return `${Math.floor(h / 24)}d`;
  } catch {
    return '—';
  }
}

const btnPrimary: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 12px',
  borderRadius: 'var(--r-m)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
};

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
};
