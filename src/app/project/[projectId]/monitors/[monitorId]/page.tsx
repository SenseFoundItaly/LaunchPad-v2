'use client';

/**
 * Monitor detail — live view of a single monitor.
 *
 * Renders the user-requested minimal entity:
 *   title / objective / prompt / schedule / last run / logs of last run /
 *   sources of last run.
 *
 * Reachable from the Signals right rail (WatcherCard becomes clickable when
 * the watcher origin is a monitor) and from /actions when a configure_monitor
 * proposal transitions to applied → the new monitor row gets a deep link
 * surfaced in the run_message UI.
 */

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';

interface MonitorDetail {
  id: string;
  name: string;
  objective: string | null;
  prompt: string | null;
  schedule: string;
  status: string;
  kind: string | null;
  type: string;
  urls_to_track: string[];
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

type TriggerType = 'scheduled' | 'manual' | 'api' | 'webhook';

interface RunRow {
  id: string;
  status: string;
  summary: string | null;
  alerts_generated: number;
  run_at: string;
  trigger_type: TriggerType;
}

// Run history filter strip — matches the reference screenshot (Tutto/Programmato/
// Manuale/API/Webhook). 'all' is the unfiltered default; the others map 1:1
// to monitor_runs.trigger_type values the backend understands.
type TriggerFilter = 'all' | TriggerType;
const TRIGGER_FILTERS: Array<{ value: TriggerFilter; label: string }> = [
  { value: 'all',       label: 'All'       },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'manual',    label: 'Manual'    },
  { value: 'api',       label: 'API'       },
  { value: 'webhook',   label: 'Webhook'   },
];

interface AlertRow {
  id: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  created_at: string;
  monitor_run_id: string | null;
}

interface DetailPayload {
  monitor: MonitorDetail;
  recent_runs: RunRow[];
  last_run: RunRow | null;
  last_run_alerts: AlertRow[];
  last_run_sources: string[];
}

export default function MonitorDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; monitorId: string }>;
}) {
  const { projectId, monitorId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all');

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const qs = new URLSearchParams();
      if (triggerFilter !== 'all') qs.set('trigger', triggerFilter);
      qs.set('runs_limit', '50');
      const res = await fetch(`/api/projects/${projectId}/monitors/${monitorId}?${qs.toString()}`);
      const body = await res.json();
      if (!res.ok || !body?.success) {
        setErrorMsg(body?.error || `HTTP ${res.status}`);
        return;
      }
      setData(body.data as DetailPayload);
    } catch (e) {
      setErrorMsg((e as Error).message || 'Failed to load monitor.');
    } finally {
      setLoading(false);
    }
  }, [projectId, monitorId, triggerFilter]);

  useEffect(() => { void fetchDetail(); }, [fetchDetail]);

  return (
    <div className="lp-frame">
      <TopBar
        projectId={projectId}
        breadcrumb={['Project', 'Signals', 'Monitor']}
        right={
          data?.monitor ? (
            <Pill kind={data.monitor.status === 'active' ? 'ok' : 'n'} dot={data.monitor.status === 'active'}>
              {data.monitor.status}
            </Pill>
          ) : null
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="signals" inboxBadge={inboxBadge} />

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px 32px',
            background: 'var(--paper)',
          }}
        >
          <div style={{ marginBottom: 14 }}>
            <Link
              href={`/project/${projectId}/actions`}
              style={{
                fontSize: 11,
                color: 'var(--ink-4)',
                textDecoration: 'none',
                fontFamily: 'var(--f-mono)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Icon d={I.chevr} size={9} style={{ transform: 'rotate(180deg)' }} />
              All signals
            </Link>
          </div>

          {loading && !data ? (
            <Skeleton text="Loading monitor…" />
          ) : errorMsg ? (
            <ErrorState message={errorMsg} />
          ) : data ? (
            <MonitorView
              data={data}
              triggerFilter={triggerFilter}
              onTriggerFilterChange={setTriggerFilter}
              loadingRuns={loading}
            />
          ) : null}
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={data?.monitor ? `monitor · ${data.monitor.schedule}` : ''}
        budget={data?.last_run_alerts ? `${data.last_run_alerts.length} alerts last run` : ''}
      />
    </div>
  );
}

// =============================================================================
// View
// =============================================================================

function MonitorView({
  data,
  triggerFilter,
  onTriggerFilterChange,
  loadingRuns,
}: {
  data: DetailPayload;
  triggerFilter: TriggerFilter;
  onTriggerFilterChange: (next: TriggerFilter) => void;
  loadingRuns: boolean;
}) {
  const m = data.monitor;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
      <header>
        <h1
          className="lp-serif"
          style={{ margin: 0, fontSize: 26, fontWeight: 400, letterSpacing: -0.4, lineHeight: 1.15 }}
        >
          {m.name}
        </h1>
        {m.objective && (
          <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {m.objective}
          </p>
        )}
        <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill kind="n">{m.schedule}</Pill>
          {m.kind && <Pill kind="n">{m.kind}</Pill>}
          {m.next_run && (
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              next run · {humanFutureAge(m.next_run)}
            </span>
          )}
        </div>
      </header>

      <Section label="Prompt" icon={I.terminal}>
        {m.prompt ? (
          <pre
            style={{
              margin: 0,
              padding: 14,
              fontSize: 12,
              color: 'var(--ink-3)',
              background: 'var(--paper-2)',
              fontFamily: 'var(--f-mono)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              lineHeight: 1.5,
            }}
          >
            {m.prompt}
          </pre>
        ) : (
          <Empty text="No prompt stored. The monitor runs against its configured URLs or query." />
        )}
      </Section>

      {m.urls_to_track.length > 0 && (
        <Section label="Tracked sources" icon={I.link}>
          <ul style={{ margin: 0, padding: '6px 14px 12px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {m.urls_to_track.map((u) => (
              <li key={u} style={{ fontSize: 12, wordBreak: 'break-all' }}>
                <a href={u} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        label="Last run"
        icon={I.clock}
        sub={data.last_run ? `${humanAge(data.last_run.run_at)} · ${data.last_run.alerts_generated} alert${data.last_run.alerts_generated === 1 ? '' : 's'}` : 'no runs yet'}
      >
        {data.last_run ? (
          <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                {new Date(data.last_run.run_at).toLocaleString()}
              </span>
              <Pill kind={data.last_run.status === 'completed' ? 'ok' : data.last_run.status === 'failed' ? 'warn' : 'n'}>
                {data.last_run.status}
              </Pill>
            </div>
            {data.last_run.summary && <p style={{ margin: 0 }}>{data.last_run.summary}</p>}
          </div>
        ) : (
          <Empty text="No runs yet. The monitor will fire on its next scheduled tick." />
        )}
      </Section>

      <Section
        label="Run history"
        icon={I.clock}
        sub={`${data.recent_runs.length} run${data.recent_runs.length === 1 ? '' : 's'}${triggerFilter !== 'all' ? ` · ${triggerFilter}` : ''}`}
      >
        <div style={{ padding: '8px 14px 4px', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {TRIGGER_FILTERS.map((f) => {
            const active = f.value === triggerFilter;
            return (
              <button
                key={f.value}
                onClick={() => onTriggerFilterChange(f.value)}
                style={{
                  fontSize: 11,
                  padding: '4px 10px',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                  background: active ? 'var(--accent-wash, var(--paper-2))' : 'transparent',
                  color: active ? 'var(--accent-ink, var(--ink-1))' : 'var(--ink-3)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        {data.recent_runs.length === 0 ? (
          <Empty text={triggerFilter === 'all' ? 'No runs yet.' : `No ${triggerFilter} runs.`} />
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {data.recent_runs.map((r) => (
              <li
                key={r.id}
                style={{
                  padding: '10px 14px',
                  borderTop: '1px solid var(--line)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  fontSize: 12.5,
                  color: 'var(--ink-2)',
                  opacity: loadingRuns ? 0.6 : 1,
                }}
              >
                <Icon
                  d={I.clock}
                  size={11}
                  stroke={1.4}
                  style={{ color: r.status === 'failed' ? 'var(--clay)' : 'var(--ink-5)' }}
                />
                <span style={{ flex: 1 }}>
                  {new Date(r.run_at).toLocaleString()}
                </span>
                {r.alerts_generated > 0 && (
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                    {r.alerts_generated} alert{r.alerts_generated === 1 ? '' : 's'}
                  </span>
                )}
                {r.status === 'failed' && <Pill kind="warn">failed</Pill>}
                <span
                  className="lp-mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-5)',
                    background: 'var(--paper-2)',
                    padding: '2px 6px',
                    borderRadius: 3,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                  }}
                >
                  {r.trigger_type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        label="Logs of last run"
        icon={I.signal}
        sub={`${data.last_run_alerts.length} alert${data.last_run_alerts.length === 1 ? '' : 's'}`}
      >
        {data.last_run_alerts.length === 0 ? (
          <Empty text="The last run emitted no alerts." />
        ) : (
          <div>
            {data.last_run_alerts.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: '10px 14px',
                  borderTop: '1px solid var(--line)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>{a.headline}</span>
                  <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
                    {(a.relevance_score * 100).toFixed(0)}%
                  </span>
                </div>
                {a.body && <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.45 }}>{a.body}</p>}
                {a.source_url && (
                  <a
                    href={a.source_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--accent)', textDecoration: 'none', wordBreak: 'break-all' }}
                  >
                    {a.source_url}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        label="Sources of last run"
        icon={I.link}
        sub={`${data.last_run_sources.length} unique`}
      >
        {data.last_run_sources.length === 0 ? (
          <Empty text="No external URLs cited in the last run." />
        ) : (
          <ul style={{ margin: 0, padding: '6px 14px 12px', listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {data.last_run_sources.map((u) => (
              <li key={u} style={{ fontSize: 12, wordBreak: 'break-all' }}>
                <a href={u} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                  {u}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function Section({
  label,
  sub,
  icon,
  children,
}: {
  label: string;
  sub?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--r-l)',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {icon && <Icon d={icon} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />}
        <h2
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--ink-3)',
          }}
        >
          {label}
        </h2>
        {sub && (
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {sub}
          </span>
        )}
      </header>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: 14, fontSize: 12, color: 'var(--ink-5)', fontStyle: 'italic' }}>
      {text}
    </div>
  );
}

function Skeleton({ text }: { text: string }) {
  return (
    <div style={{ padding: 24, fontSize: 12, color: 'var(--ink-5)', fontFamily: 'var(--f-mono)' }}>
      {text}
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: 14,
        fontSize: 12,
        color: 'var(--clay)',
        background: 'rgba(180,80,40,0.08)',
        border: '1px solid rgba(180,80,40,0.3)',
        borderRadius: 'var(--r-l)',
        maxWidth: 880,
      }}
    >
      {message}
    </div>
  );
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function humanFutureAge(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'overdue';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.floor(h / 24)}d`;
}
