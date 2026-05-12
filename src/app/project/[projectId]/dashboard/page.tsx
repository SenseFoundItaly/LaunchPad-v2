'use client';

/**
 * Dashboard — ported to the "Founder OS" design (screen-home.jsx).
 *
 * Single-pane-of-glass aggregating:
 *   - Masthead: greeting + weekly summary blurb + 5 metric tiles with sparklines
 *   - Heartbeat: recent monitor_runs + ecosystem_alerts (agent activity log)
 *   - Tickets: pending_actions (the approval inbox, preview of top 4)
 *   - Mini graph: graph_nodes force-directed preview
 *   - Next up: milestones table
 *   - Budget: llm_usage_logs grouped by step, with per-row spend bars
 *
 * The floating ProjectChatDrawer stays mounted at the bottom-right so the
 * founder can "Ask your co-founder" from this screen.
 *
 * Visual design uses CSS custom properties from src/styles/design-tokens.css
 * (theme-ink applied globally in root layout). Tailwind is not used here —
 * this is a full-bleed design-system page.
 */

import { use, useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import api from '@/api';
import { useProject } from '@/hooks/useProject';
import ProjectChatDrawer from '@/components/chat/ProjectChatDrawer';
import PendingKnowledgeList from '@/components/knowledge/PendingKnowledgeList';
import { TopBar, NavRail } from '@/components/design/chrome';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import {
  Pill,
  Panel,
  MetricTile,
  StatusBar,
  Icon,
  IconBtn,
  I,
} from '@/components/design/primitives';
import type { HeartbeatKind } from '@/components/design/primitives';
import CronSettingsPanel from '@/components/cron/CronSettingsPanel';
import type { ApiResponse, SignalTimelineEntry } from '@/types';

// =============================================================================
// Payload types (matches /api/dashboard/{id} extended shape)
// =============================================================================

interface MetricEntry {
  date: string;
  value: number;
}

interface Metric {
  id: string;
  name: string;
  type: string;
  target_growth_rate: number;
  entries?: MetricEntry[];
}

interface BurnRow {
  monthly_burn: number;
  cash_on_hand: number;
}

interface AlertRow {
  id: string;
  type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  created_at: string;
  dismissed: number;
}

interface MonitorRow {
  id: string;
  type: string;
  name: string;
  status: string;
  last_run: string | null;
  last_result: string | null;
}

interface EcosystemAlertPreview {
  id: string;
  alert_type: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  confidence: number;
  created_at: string;
}

interface PendingDecisionPreview {
  id: string;
  action_type: string;
  title: string;
  rationale: string | null;
  estimated_impact: string | null;
  status: string;
  created_at: string;
}

interface BudgetPayload {
  current_llm_usd: number;
  warn_llm_usd: number;
  cap_llm_usd: number;
  status: string;
}

interface DashboardPayload {
  metrics: Metric[];
  burn_rate: BurnRow | null;
  alerts: AlertRow[];
  monitors: MonitorRow[];
  top_ecosystem_alerts?: EcosystemAlertPreview[];
  pending_decisions?: PendingDecisionPreview[];
  pending_summary?: { pending: number; edited: number; approved: number; sent_7d: number };
  budget?: BudgetPayload;
  period_month?: string;
}

interface GraphNodeRow {
  id: string;
  name: string;
  node_type: string;
}

interface JourneyPayload {
  milestones?: Array<{ milestone_id?: string; id?: string; week: number; title: string; status: string }>;
}

// -- Readiness widget types --
interface ReadinessSectionScore {
  key: string;
  label: string;
  score: number;
  available: boolean;
  fallback: boolean;
}

interface ReadinessStage {
  number: number;
  name: string;
  score: number;
  verdict: string;
  sections: ReadinessSectionScore[];
}

interface ReadinessPayload {
  overall_score: number;
  overall_verdict: string;
  stages: ReadinessStage[];
}

interface LlmUsageGroupRow {
  step: string | null;
  provider: string;
  model: string;
  total_cost_usd: number;
  call_count: number;
}

// =============================================================================
// Page
// =============================================================================

export default function DashboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { project } = useProject(projectId);

  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [usageGroups, setUsageGroups] = useState<LlmUsageGroupRow[]>([]);
  const [signalEntries, setSignalEntries] = useState<SignalTimelineEntry[]>([]);
  const [readiness, setReadiness] = useState<ReadinessPayload | null>(null);
  const [cronbeat, setCronbeat] = useState<{ health: HeartbeatKind; hours_since_last: number | null } | null>(null);
  const [cronPanelOpen, setCronPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const fetchAll = useCallback(async () => {
    try {
      const [dash, usage, signals, beat, readinessRes] = await Promise.all([
        api.get<ApiResponse<DashboardPayload>>(`/api/dashboard/${projectId}`),
        api.get<ApiResponse<LlmUsageGroupRow[]>>(`/api/projects/${projectId}/usage/groups`).catch(() => ({ data: { data: [] } })),
        fetch(`/api/projects/${projectId}/signals?days=7&limit=8`).then(r => r.json()).catch(() => ({ success: false, data: [] })),
        api.get<ApiResponse<{ health: HeartbeatKind; hours_since_last: number | null }>>('/api/cronbeat').catch(() => null),
        fetch(`/api/projects/${projectId}/readiness`).then(r => r.json()).catch(() => null),
      ]);
      if (dash.data?.data) setPayload(dash.data.data);
      const groups = (usage.data as ApiResponse<LlmUsageGroupRow[]> | undefined)?.data;
      setUsageGroups(Array.isArray(groups) ? groups : []);
      if (signals?.success && Array.isArray(signals.data)) {
        setSignalEntries(signals.data);
      }
      if (beat?.data?.data) setCronbeat(beat.data.data);
      if (readinessRes?.success && readinessRes.data) {
        setReadiness(readinessRes.data as ReadinessPayload);
      }
    } catch {
      // Partial data is fine — the page renders empty panels gracefully
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Derived data for sub-panels
  const metricTiles = useMemo(() => {
    if (!payload) return [];
    return payload.metrics.slice(0, 5).map((m) => {
      const entries = m.entries || [];
      const latest = entries[entries.length - 1]?.value;
      const prior = entries[entries.length - 2]?.value;
      const delta = latest != null && prior != null && prior !== 0
        ? `${latest > prior ? '+' : ''}${(((latest / prior) - 1) * 100).toFixed(1)}%`
        : undefined;
      const sparkData = entries.map(e => e.value);
      const kind: 'ok' | 'warn' | 'n' = latest != null && prior != null
        ? (latest >= prior ? 'ok' : 'warn')
        : 'n';
      const valueStr = m.type === 'currency'
        ? (latest != null ? `€${latest.toLocaleString('it-IT')}` : '—')
        : m.type === 'percentage'
          ? (latest != null ? `${latest}%` : '—')
          : (latest != null ? latest.toLocaleString('it-IT') : '—');
      return { label: m.name, value: valueStr, delta, sparkData, kind };
    });
  }, [payload]);

  const runway = payload?.burn_rate && payload.burn_rate.monthly_burn > 0
    ? payload.burn_rate.cash_on_hand / payload.burn_rate.monthly_burn
    : null;

  // Masthead greeting — locale-aware; swap to IT when project.locale='it'
  const locale = (project as unknown as { locale?: string })?.locale === 'it' ? 'it' : 'en';
  const hour = new Date().getHours();
  const greeting = locale === 'it'
    ? (hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera')
    : (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');

  const overnightAgentCount = payload?.monitors.filter(m => m.status === 'active').length ?? 0;
  const overnightToolCalls = Math.min(99, payload?.monitors.length ?? 0);

  const statusBarBudget = payload?.budget
    ? `budget · $${payload.budget.current_llm_usd.toFixed(2)} / $${payload.budget.cap_llm_usd.toFixed(2)} mo`
    : 'budget · —';

  const lastHeartbeat = useMemo(() => {
    if (cronbeat) {
      const h = cronbeat.health;
      if (cronbeat.hours_since_last == null) {
        return locale === 'it' ? 'cron · mai eseguito' : 'cron · never run';
      }
      const hrs = cronbeat.hours_since_last;
      const agoStr = hrs < 1 ? '<1h ago' : `${Math.round(hrs)}h ago`;
      return `cron · ${h} · ${agoStr}`;
    }
    // Fallback to monitor-based estimate
    const lastRun = payload?.monitors
      .map(m => m.last_run)
      .filter((x): x is string => !!x)
      .sort()
      .pop();
    if (!lastRun) return locale === 'it' ? 'heartbeat · mai eseguito' : 'heartbeat · never run';
    const ago = Math.floor((Date.now() - new Date(lastRun).getTime()) / 1000);
    if (ago < 60) return `heartbeat · ${ago}s ago`;
    if (ago < 3600) return `heartbeat · ${Math.floor(ago / 60)}m ago`;
    return `heartbeat · ${Math.floor(ago / 3600)}h ago`;
  }, [payload, cronbeat, locale]);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={[project?.name || 'Project', locale === 'it' ? 'Command Center' : 'Command Center']}
        right={
          <>
            <Pill kind={overnightAgentCount > 0 ? 'live' : 'n'} dot={overnightAgentCount > 0}>
              {overnightAgentCount > 0
                ? `live · ${overnightAgentCount} monitor${overnightAgentCount === 1 ? '' : 's'}`
                : 'idle'}
            </Pill>
          </>
        }
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="home" inboxBadge={inboxBadge} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Masthead */}
          <div
            style={{
              padding: '28px 32px 20px',
              borderBottom: '1px solid var(--line)',
              background: 'var(--surface)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 32 }}>
              <div>
                <div
                  className="lp-mono"
                  style={{
                    fontSize: 10,
                    color: 'var(--ink-5)',
                    letterSpacing: 1,
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  {project?.status || 'project'} · {project?.description?.slice(0, 60) || (locale === 'it' ? 'pre-seed' : 'pre-seed')}
                </div>
                <h1
                  className="lp-serif"
                  style={{ fontSize: 44, fontWeight: 400, letterSpacing: -1.2, margin: 0, lineHeight: 1 }}
                >
                  {greeting}, {project?.name?.split(' ')[0] || 'founder'}.
                </h1>
                <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, maxWidth: 620 }}>
                  {buildMastheadNarrative(payload, overnightToolCalls, locale)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Link href={`/project/${projectId}/brief`} style={btnGhost}>
                  <Icon d={I.history} size={13} />
                  {locale === 'it' ? 'Monday Brief' : 'Weekly brief'}
                </Link>
                <Link href={`/project/${projectId}/chat`} style={btnPrimary}>
                  <Icon d={I.sparkles} size={13} />
                  {locale === 'it' ? 'Chiedi al co-pilot' : 'Ask co-pilot'}
                  <span
                    className="lp-kbd"
                    style={{
                      background: 'rgba(255,255,255,.12)',
                      borderColor: 'rgba(255,255,255,.2)',
                      color: 'var(--paper)',
                    }}
                  >
                    ⌘K
                  </span>
                </Link>
              </div>
            </div>

            {/* Metric tiles — up to 5, filled with empties if fewer */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginTop: 24 }}>
              {metricTiles.map((tile, i) => (
                <MetricTile
                  key={i}
                  label={tile.label}
                  value={tile.value}
                  delta={tile.delta}
                  sparkData={tile.sparkData}
                  kind={tile.kind}
                />
              ))}
              {/* Runway is always computed, shown as the last tile if room */}
              {metricTiles.length < 5 && runway != null && (
                <MetricTile
                  label={locale === 'it' ? 'Runway' : 'Runway'}
                  value={`${runway.toFixed(1)} mo`}
                  delta={runway < 6 ? (locale === 'it' ? 'attenzione' : 'warn') : 'on plan'}
                  kind={runway < 6 ? 'warn' : 'n'}
                />
              )}
              {/* Fill remaining slots with placeholders so the grid stays 5-wide */}
              {Array.from({ length: Math.max(0, 5 - metricTiles.length - (metricTiles.length < 5 && runway != null ? 1 : 0)) }).map((_, i) => (
                <EmptyMetric key={`empty-${i}`} locale={locale} />
              ))}
            </div>
          </div>

          {/* Body grid */}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <HeartbeatSection
                monitors={payload?.monitors || []}
                ecosystemAlerts={payload?.top_ecosystem_alerts || []}
                locale={locale}
                projectId={projectId}
                overnightAgentCount={overnightAgentCount}
                onOpenCronSettings={() => setCronPanelOpen(true)}
              />

              <Panel
                title={locale === 'it' ? 'Ticket' : 'Tickets'}
                subtitle={locale === 'it' ? 'Lavoro in attesa di decisione' : 'Goal-linked work in motion'}
                right={
                  <Link href={`/project/${projectId}/actions`} style={linkStyle}>
                    {locale === 'it' ? 'vedi tutto' : 'view all'}
                    <Icon d={I.arrow} size={10} />
                  </Link>
                }
              >
                <TicketListPanel decisions={payload?.pending_decisions || []} locale={locale} />
              </Panel>

              <Panel
                title={locale === 'it' ? 'Revisione Conoscenze' : 'Knowledge Review'}
                subtitle={locale === 'it' ? 'Elementi in attesa di approvazione' : 'Items awaiting your approval'}
              >
                <PendingKnowledgeList projectId={projectId} />
              </Panel>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Panel
                title={locale === 'it' ? 'Segnali' : 'Signals'}
                subtitle={`${signalEntries.length} · ${locale === 'it' ? 'ultimi 7g' : 'last 7d'}`}
                right={
                  <Link href={`/project/${projectId}/signals`} style={linkStyle}>
                    {locale === 'it' ? 'vedi tutto' : 'view all'}
                    <Icon d={I.arrow} size={10} />
                  </Link>
                }
              >
                <SignalsPreviewPanel signals={signalEntries} locale={locale} />
              </Panel>

              <ReadinessWidget
                readiness={readiness}
                locale={locale}
                projectId={projectId}
              />

              <CollapsibleBudgetPanel
                usageGroups={usageGroups}
                budget={payload?.budget || null}
                periodMonth={payload?.period_month}
                locale={locale}
              />
            </div>
          </div>
        </div>
      </div>

      <StatusBar
        heartbeatLabel={lastHeartbeat}
        heartbeatKind={cronbeat?.health || 'healthy'}
        gateway="pi-agent · anthropic"
        ctxLabel={`ctx · ${signalEntries.length} signals`}
        budget={statusBarBudget}
        tz="tz · Europe/Rome"
        hints={[
          ...(loading ? [locale === 'it' ? 'sto caricando…' : 'loading…'] : []),
        ]}
      />

      {/* Cron settings slide-over */}
      <CronSettingsPanel
        projectId={projectId}
        open={cronPanelOpen}
        onClose={() => setCronPanelOpen(false)}
      />

      {/* Floating "Ask your co-founder" drawer — wired to the same chat agent
          with full project-scoped tools (list_ecosystem_alerts,
          list_pending_actions, queue_draft_for_approval, ...) */}
      <ProjectChatDrawer projectId={projectId} />
    </div>
  );
}

// =============================================================================
// Masthead narrative — SOUL-voiced opening blurb
// =============================================================================

function buildMastheadNarrative(
  payload: DashboardPayload | null,
  toolCalls: number,
  locale: 'en' | 'it',
): React.ReactNode {
  if (!payload) {
    return locale === 'it'
      ? 'Carico i segnali del tuo progetto…'
      : 'Loading your project signals…';
  }
  const alertCount = payload.top_ecosystem_alerts?.length ?? 0;
  const pendingCount = (payload.pending_summary?.pending ?? 0) + (payload.pending_summary?.edited ?? 0);
  const agentCount = payload.monitors.filter(m => m.status === 'active').length;

  if (locale === 'it') {
    const parts: React.ReactNode[] = [];
    if (agentCount > 0) {
      parts.push(<span key="a"><b style={{ color: 'var(--ink)' }}>{agentCount} monitor</b> attivi hanno fatto <b style={{ color: 'var(--ink)' }}>{toolCalls} chiamate tool</b> di notte. </span>);
    }
    if (alertCount > 0) {
      parts.push(<span key="b">Ecosystem ha fatto emergere <i style={{ color: 'var(--accent-ink)', fontStyle: 'normal' }}>{alertCount} segnali</i>. </span>);
    }
    if (pendingCount > 0) {
      parts.push(<span key="c">Hai <b style={{ color: 'var(--ink)' }}>{pendingCount} decision{pendingCount === 1 ? 'e' : 'i'} in attesa</b>.</span>);
    }
    if (parts.length === 0) {
      parts.push(<span key="d">Settimana tranquilla. Tempo di alzare l&apos;asticella.</span>);
    }
    return parts;
  }

  const parts: React.ReactNode[] = [];
  if (agentCount > 0) {
    parts.push(<span key="a"><b style={{ color: 'var(--ink)' }}>{agentCount} agent{agentCount === 1 ? '' : 's'}</b> made <b style={{ color: 'var(--ink)' }}>{toolCalls} tool calls</b> overnight. </span>);
  }
  if (alertCount > 0) {
    parts.push(<span key="b">Ecosystem surfaced <i style={{ color: 'var(--accent-ink)', fontStyle: 'normal' }}>{alertCount} signal{alertCount === 1 ? '' : 's'}</i>. </span>);
  }
  if (pendingCount > 0) {
    parts.push(<span key="c">You have <b style={{ color: 'var(--ink)' }}>{pendingCount} decision{pendingCount === 1 ? '' : 's'} waiting</b>.</span>);
  }
  if (parts.length === 0) {
    parts.push(<span key="d">Quiet week. Good moment to raise the bar.</span>);
  }
  return parts;
}

// =============================================================================
// Heartbeat section — expandable activity stream with "view all" mode
// =============================================================================

type HeartbeatEvent = {
  t: string;
  agent: string;
  role: string;
  msg: string;
  target: string;
  tag: string;
  kind: 'live' | 'ok' | 'info' | 'warn' | 'n';
  full?: string;
};

interface ActivityApiEvent {
  id: string;
  at: string;
  tag: string;
  label: string;
  body?: string;
  href?: string;
}

const ACTIVITY_FILTER_TAGS = ['All', 'SCAN', 'CEO', 'TASK', 'ALERT'] as const;

function HeartbeatSection({
  monitors,
  ecosystemAlerts,
  locale,
  projectId,
  overnightAgentCount,
  onOpenCronSettings,
}: {
  monitors: MonitorRow[];
  ecosystemAlerts: EcosystemAlertPreview[];
  locale: 'en' | 'it';
  projectId: string;
  overnightAgentCount: number;
  onOpenCronSettings?: () => void;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [viewAll, setViewAll] = useState(false);
  const [activityEvents, setActivityEvents] = useState<ActivityApiEvent[] | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [filterTag, setFilterTag] = useState<string>('All');

  // Build condensed events from monitors + ecosystem alerts
  const condensedEvents = useMemo(() => {
    const events: HeartbeatEvent[] = [];

    for (const alert of ecosystemAlerts.slice(0, 4)) {
      events.push({
        t: alert.created_at,
        agent: 'Scout',
        role: alert.alert_type.replace('_', ' '),
        msg: alert.headline.slice(0, 80),
        target: alert.source_url ? safeHost(alert.source_url) : '',
        tag: `${(alert.relevance_score * 100).toFixed(0)}% rilevante`,
        kind: alert.relevance_score > 0.8 ? 'live' : alert.relevance_score > 0.6 ? 'ok' : 'n',
        full: alert.body || undefined,
      });
    }

    for (const m of monitors.slice(0, 4)) {
      if (!m.last_run) continue;
      events.push({
        t: m.last_run,
        agent: agentNameFromType(m.type),
        role: roleFromType(m.type),
        msg: locale === 'it' ? `Scan completato · ${m.name}` : `Scan completed · ${m.name}`,
        target: (m.last_result || '').slice(0, 60).replace(/\s+/g, ' '),
        tag: 'monitor',
        kind: 'n',
        full: m.last_result || undefined,
      });
    }

    events.sort((a, b) => b.t.localeCompare(a.t));
    return events.slice(0, 6);
  }, [monitors, ecosystemAlerts, locale]);

  // Fetch full activity on "view all"
  const handleExpandAll = useCallback(async () => {
    if (viewAll) {
      setViewAll(false);
      return;
    }
    setViewAll(true);
    if (!activityEvents) {
      setActivityLoading(true);
      try {
        const res = await api.get<ApiResponse<{ events: ActivityApiEvent[] }>>(
          `/api/projects/${projectId}/activity`,
        );
        setActivityEvents(res.data?.data?.events || []);
      } catch {
        setActivityEvents([]);
      } finally {
        setActivityLoading(false);
      }
    }
  }, [viewAll, activityEvents, projectId]);

  // Filtered activity events for "view all" mode
  const filteredActivity = useMemo(() => {
    if (!activityEvents) return [];
    if (filterTag === 'All') return activityEvents;
    return activityEvents.filter(e => e.tag === filterTag);
  }, [activityEvents, filterTag]);

  return (
    <Panel
      title={locale === 'it' ? 'Heartbeat di oggi' : "Today's heartbeat"}
      right={
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Pill kind="live" dot>
            {overnightAgentCount > 0
              ? `live · ${overnightAgentCount} monitor${overnightAgentCount === 1 ? '' : 's'}`
              : 'idle'}
          </Pill>
          <IconBtn
            d={I.sliders}
            size={22}
            title="Cron settings"
            onClick={onOpenCronSettings}
          />
          <IconBtn
            d={viewAll ? I.collapse : I.expand}
            size={22}
            title={viewAll ? 'Collapse' : 'Expand activity log'}
            onClick={handleExpandAll}
            active={viewAll}
          />
        </span>
      }
    >
      {viewAll ? (
        <div style={{ padding: '4px 0' }}>
          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 6, padding: '6px 14px 10px', flexWrap: 'wrap' }}>
            {ACTIVITY_FILTER_TAGS.map(tag => (
              <button
                key={tag}
                onClick={() => setFilterTag(tag)}
                style={{
                  padding: '3px 10px',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 'var(--r-m)',
                  border: '1px solid var(--line)',
                  background: filterTag === tag ? 'var(--paper-3)' : 'transparent',
                  color: filterTag === tag ? 'var(--ink)' : 'var(--ink-4)',
                  cursor: 'pointer',
                  transition: 'background .12s',
                }}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Scrollable full timeline */}
          <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '0' }}>
            {activityLoading && (
              <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
                Loading activity…
              </div>
            )}
            {!activityLoading && filteredActivity.length === 0 && (
              <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
                {locale === 'it' ? 'Nessun evento trovato.' : 'No events found.'}
              </div>
            )}
            {!activityLoading &&
              filteredActivity.map((ev, i) => (
                <ActivityRow key={ev.id} event={ev} locale={locale} isLast={i === filteredActivity.length - 1} />
              ))}
          </div>
        </div>
      ) : condensedEvents.length === 0 ? (
        <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
          {locale === 'it'
            ? "Nessuna attività recente. Lancia uno scan dall'inbox o dalla Brief."
            : 'No recent activity. Trigger a scan from the inbox or Brief.'}
        </div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {condensedEvents.map((e, i) => (
            <div key={i}>
              <div
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '60px 118px 1fr auto',
                  gap: 12,
                  padding: '10px 14px',
                  borderBottom: i < condensedEvents.length - 1 && expandedIdx !== i ? '1px solid var(--line)' : 'none',
                  alignItems: 'center',
                  cursor: e.full ? 'pointer' : 'default',
                  transition: 'background .1s',
                }}
                onMouseEnter={(ev) => { if (e.full) (ev.currentTarget as HTMLDivElement).style.background = 'var(--paper-2)'; }}
                onMouseLeave={(ev) => { (ev.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {formatTimeAgo(e.t, locale)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      background: agentColor(e.agent),
                      color: '#fff',
                      fontSize: 9,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--f-mono)',
                    }}
                  >
                    {e.agent.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{e.agent}</span>
                  <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
                    {e.role}
                  </span>
                </span>
                <span style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  <span style={{ color: 'var(--ink-2)' }}>{e.msg}</span>
                  {e.target && <span style={{ color: 'var(--ink-4)' }}> — {e.target}</span>}
                </span>
                <Pill kind={e.kind} dot={e.kind !== 'n'}>
                  {e.tag}
                </Pill>
              </div>
              {/* Expanded body */}
              {expandedIdx === i && e.full && (
                <div
                  style={{
                    margin: '0 14px 8px',
                    padding: '10px 12px',
                    background: 'var(--paper-2)',
                    borderLeft: `3px solid ${agentColor(e.agent)}`,
                    borderRadius: '0 var(--r-m) var(--r-m) 0',
                    maxHeight: 300,
                    overflowY: 'auto',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: 'var(--ink-3)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    borderBottom: i < condensedEvents.length - 1 ? '1px solid var(--line)' : 'none',
                  }}
                >
                  {e.full}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Single row in the "view all" activity timeline */
function ActivityRow({
  event,
  locale,
  isLast,
}: {
  event: ActivityApiEvent;
  locale: 'en' | 'it';
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tagColor: Record<string, string> = {
    SCAN: 'var(--sky)',
    CEO: 'var(--plum)',
    TASK: 'var(--moss)',
    ALERT: 'oklch(0.60 0.14 20)',
    CHIEF: 'var(--ink-3)',
    YOU: 'var(--ink-4)',
    DRAFT: 'var(--ink-5)',
    AGENT: 'var(--sky)',
  };
  const color = tagColor[event.tag] || 'var(--ink-4)';

  return (
    <div>
      <div
        onClick={() => event.body && setOpen(!open)}
        style={{
          display: 'grid',
          gridTemplateColumns: '14px 60px 56px 1fr',
          gap: 10,
          padding: '9px 14px',
          borderBottom: !isLast && !open ? '1px solid var(--line)' : 'none',
          alignItems: 'start',
          cursor: event.body ? 'pointer' : 'default',
          transition: 'background .1s',
        }}
        onMouseEnter={(e) => { if (event.body) (e.currentTarget as HTMLDivElement).style.background = 'var(--paper-2)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
      >
        <span style={{ color: 'var(--ink-5)', fontSize: 10, paddingTop: 1 }}>
          {event.body ? <Icon d={open ? I.chevd : I.chevr} size={10} /> : null}
        </span>
        <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
          {formatTimeAgo(event.at, locale)}
        </span>
        <Pill kind="n">
          {event.tag}
        </Pill>
        <span style={{ fontSize: 12, color: 'var(--ink-2)', minWidth: 0 }}>
          {event.label}
        </span>
      </div>
      {open && event.body && (
        <div
          style={{
            margin: '0 14px 8px',
            padding: '10px 12px',
            background: 'var(--paper-2)',
            borderLeft: `3px solid ${color}`,
            borderRadius: '0 var(--r-m) var(--r-m) 0',
            maxHeight: 300,
            overflowY: 'auto',
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--ink-3)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            borderBottom: !isLast ? '1px solid var(--line)' : 'none',
          }}
        >
          {event.body}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Ticket list — pending_actions preview
// =============================================================================

function TicketListPanel({
  decisions,
  locale,
}: {
  decisions: PendingDecisionPreview[];
  locale: 'en' | 'it';
}) {
  if (decisions.length === 0) {
    return (
      <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it'
          ? 'Nessuna decisione in coda. Il co-founder è silente — per ora.'
          : 'No decisions queued. Your co-founder is quiet — for now.'}
      </div>
    );
  }
  const statusMap: Record<string, 'live' | 'info' | 'warn' | 'n'> = {
    pending: 'live',
    edited: 'info',
    approved: 'ok' as 'info',
    rejected: 'n',
  };
  return (
    <div>
      {decisions.slice(0, 4).map((r, i) => (
        <div
          key={r.id}
          style={{
            padding: '10px 14px',
            borderBottom: i < Math.min(3, decisions.length - 1) ? '1px solid var(--line)' : 'none',
            display: 'grid',
            gridTemplateColumns: '64px 1fr auto',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span className="lp-mono" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {r.id.replace(/^pa_/, 'T-').slice(0, 8)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
              {r.title}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, fontSize: 10.5, color: 'var(--ink-5)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon d={I.flag} size={10} />
                {r.action_type.replace(/_/g, ' ')}
              </span>
              {r.estimated_impact && (
                <>
                  <span>·</span>
                  <span>{r.estimated_impact} impact</span>
                </>
              )}
            </div>
          </div>
          <Pill kind={statusMap[r.status] || 'n'} dot={r.status !== 'rejected'}>
            {r.status}
          </Pill>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Mini graph — SVG force-directed preview (static layout, real node names)
// =============================================================================

function MiniGraph({ nodes }: { nodes: GraphNodeRow[] }) {
  const colorMap: Record<string, string> = {
    your_startup: 'var(--ink)',
    competitor: 'var(--clay)',
    market_segment: 'var(--sky)',
    technology: 'var(--moss)',
    trend: 'var(--moss)',
    risk: 'oklch(0.60 0.14 20)',
    persona: 'var(--plum)',
    partner: 'var(--sky)',
  };

  // Sort by node_type heuristic so the self node (if any) is prominent
  const selfNode = nodes.find(n => n.node_type === 'your_startup');
  const others = nodes.filter(n => n !== selfNode).slice(0, 8);

  // Static layout — self at center, others in a circle around it
  const width = 320;
  const height = 220;
  const cx = 160;
  const cy = 105;
  const ringRadius = 75;

  const positioned = others.map((n, i) => {
    const angle = (i / Math.max(1, others.length)) * 2 * Math.PI;
    return {
      ...n,
      x: cx + Math.cos(angle) * ringRadius,
      y: cy + Math.sin(angle) * ringRadius,
      r: 7,
    };
  });

  const selfPos = { x: cx, y: cy, r: 14, name: selfNode?.name || 'You', node_type: 'your_startup' };

  if (nodes.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          background: 'var(--paper)',
          height: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          color: 'var(--ink-5)',
        }}
      >
        Nessun nodo nel graph. Il co-founder lo popola durante gli scan settimanali.
      </div>
    );
  }

  return (
    <div style={{ padding: 12, background: 'var(--paper)', position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height }}>
        {positioned.map(n => (
          <line
            key={`edge-${n.id}`}
            x1={selfPos.x}
            y1={selfPos.y}
            x2={n.x}
            y2={n.y}
            stroke="var(--ink-6)"
            strokeWidth="0.5"
            opacity="0.7"
          />
        ))}
        <g>
          <circle cx={selfPos.x} cy={selfPos.y} r={selfPos.r + 6} fill="none" stroke="var(--ink)" strokeWidth="0.5" opacity="0.3" />
          <circle cx={selfPos.x} cy={selfPos.y} r={selfPos.r} fill={colorMap.your_startup} />
          <text
            x={selfPos.x}
            y={selfPos.y + selfPos.r + 10}
            fontSize="9"
            fill="var(--ink-3)"
            textAnchor="middle"
            fontFamily="var(--f-mono)"
          >
            {selfPos.name.slice(0, 16)}
          </text>
        </g>
        {positioned.map(n => (
          <g key={n.id}>
            <circle cx={n.x} cy={n.y} r={n.r} fill={colorMap[n.node_type] || 'var(--ink-5)'} opacity={0.85} />
            <text
              x={n.x}
              y={n.y + n.r + 10}
              fontSize="9"
              fill="var(--ink-3)"
              textAnchor="middle"
              fontFamily="var(--f-mono)"
            >
              {n.name.slice(0, 14)}
            </text>
          </g>
        ))}
      </svg>
      <div
        style={{
          position: 'absolute',
          left: 14,
          top: 14,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 10,
          fontFamily: 'var(--f-mono)',
        }}
      >
        {[
          ['your_startup', 'you'],
          ['competitor', 'competitors'],
          ['market_segment', 'markets'],
          ['technology', 'tech'],
          ['risk', 'risks'],
        ].map(([k, l]) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'var(--ink-4)' }}>
            <span className="lp-dot" style={{ background: colorMap[k] }} /> {l}
          </div>
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Readiness widget — compact 7-stage overview with micro section bars
// =============================================================================

const VERDICT_DOT: Record<string, string> = {
  'STRONG GO': 'var(--moss)',
  'GO': '#34d399',
  'CAUTION': '#fbbf24',
  'NOT READY': 'oklch(0.60 0.14 20)',
};

const VERDICT_PILL: Record<string, 'ok' | 'warn' | 'n' | 'live'> = {
  'STRONG GO': 'ok',
  'GO': 'ok',
  'CAUTION': 'warn',
  'NOT READY': 'n',
};

function ReadinessWidget({
  readiness,
  locale,
  projectId,
}: {
  readiness: ReadinessPayload | null;
  locale: 'en' | 'it';
  projectId: string;
}) {
  return (
    <Panel
      title={locale === 'it' ? 'Readiness' : 'Readiness'}
      subtitle={
        readiness
          ? `${readiness.overall_score.toFixed(1)}/10`
          : undefined
      }
      right={
        readiness ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Pill kind={VERDICT_PILL[readiness.overall_verdict] || 'n'} dot>
              {readiness.overall_verdict}
            </Pill>
            <Link href={`/project/${projectId}/readiness`} style={rdLinkStyle}>
              {locale === 'it' ? 'dettagli' : 'view all'}
              <Icon d={I.arrow} size={10} />
            </Link>
          </span>
        ) : null
      }
    >
      {!readiness ? (
        <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
          {locale === 'it' ? 'Caricamento readiness…' : 'Loading readiness…'}
        </div>
      ) : (
        <div>
          {readiness.stages.map((stage, i) => {
            const topSections = stage.sections
              .filter(s => s.available)
              .sort((a, b) => b.score - a.score)
              .slice(0, 4);

            return (
              <div
                key={stage.number}
                style={{
                  padding: '8px 14px',
                  borderBottom: i < readiness.stages.length - 1 ? '1px solid var(--line)' : 'none',
                  display: 'grid',
                  gridTemplateColumns: '22px 1fr auto auto',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <span
                  className="lp-mono"
                  style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'center' }}
                >
                  {stage.number}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-2)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {stage.name}
                </span>
                {/* Micro section bars */}
                <span style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                  {topSections.map((sec) => (
                    <span
                      key={sec.key}
                      title={`${sec.label}: ${sec.score.toFixed(1)}`}
                      style={{
                        width: 16,
                        height: 4,
                        borderRadius: 2,
                        background: sec.score >= 7
                          ? 'var(--moss)'
                          : sec.score >= 5
                            ? '#fbbf24'
                            : 'oklch(0.60 0.14 20)',
                        opacity: 0.8,
                      }}
                    />
                  ))}
                  {topSections.length === 0 && (
                    <span style={{ width: 16, height: 4, borderRadius: 2, background: 'var(--line-2)' }} />
                  )}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    className="lp-mono"
                    style={{ fontSize: 11, color: 'var(--ink-3)', minWidth: 28, textAlign: 'right' }}
                  >
                    {stage.score.toFixed(1)}
                  </span>
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: VERDICT_DOT[stage.verdict] || 'var(--ink-5)',
                    }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

const rdLinkStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ink-4)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  textDecoration: 'none',
};

// =============================================================================
// Milestones + Budget rows
// =============================================================================

function MilestoneList({
  items,
  locale,
}: {
  items: JourneyPayload['milestones'];
  locale: 'en' | 'it';
}) {
  const safeItems = items || [];
  if (safeItems.length === 0) {
    return (
      <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it' ? 'Nessuna milestone definita.' : 'No milestones set.'}
      </div>
    );
  }
  return (
    <div>
      {safeItems.slice(0, 4).map((it, i) => (
        <div
          key={it.id || it.milestone_id || i}
          style={{
            padding: '9px 14px',
            borderBottom: i < Math.min(3, safeItems.length - 1) ? '1px solid var(--line)' : 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 7,
              border: '1px solid',
              borderColor: it.status === 'completed' ? 'var(--moss)' : 'var(--line-2)',
              background: it.status === 'completed' ? 'var(--moss)' : 'transparent',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {it.status === 'completed' && (
              <Icon d={I.check} size={9} style={{ color: '#fff', strokeWidth: 2 }} />
            )}
          </span>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)', width: 32 }}>
            W{it.week}
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--ink-2)',
              flex: 1,
              textDecoration: it.status === 'completed' ? 'line-through' : 'none',
              textDecorationColor: 'var(--ink-5)',
            }}
          >
            {it.title}
          </span>
        </div>
      ))}
    </div>
  );
}

function BudgetRows({
  groups,
  budget,
}: {
  groups: LlmUsageGroupRow[];
  budget: BudgetPayload | null;
}) {
  const cap = budget?.cap_llm_usd || 1;
  const rows = groups.length > 0
    ? groups.slice(0, 5)
    : [{ step: 'No LLM calls yet', provider: '', model: '', total_cost_usd: 0, call_count: 0 }];

  return (
    <div>
      {rows.map((r, i) => {
        const name = r.step || 'unlabeled';
        const pct = cap > 0 ? (r.total_cost_usd / cap) * 100 : 0;
        return (
          <div
            key={i}
            style={{
              padding: '9px 14px',
              borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--ink-2)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {name}
            </span>
            <div style={{ width: 90, height: 4, borderRadius: 2, background: 'var(--line-2)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(100, pct)}%`,
                  height: '100%',
                  background: pct > 80 ? 'var(--clay)' : 'var(--ink-3)',
                }}
              />
            </div>
            <span
              className="lp-mono"
              style={{ fontSize: 10, color: 'var(--ink-4)', minWidth: 72, textAlign: 'right' }}
            >
              ${r.total_cost_usd.toFixed(3)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CollapsibleBudgetPanel({
  usageGroups,
  budget,
  periodMonth,
  locale,
}: {
  usageGroups: LlmUsageGroupRow[];
  budget: BudgetPayload | null;
  periodMonth?: string;
  locale: 'en' | 'it';
}) {
  const [expanded, setExpanded] = useState(false);
  const summaryLine = budget
    ? `Budget: $${budget.current_llm_usd.toFixed(2)} / $${budget.cap_llm_usd.toFixed(2)}`
    : (locale === 'it' ? 'Budget: —' : 'Budget: —');

  return (
    <Panel
      title={locale === 'it' ? 'Budget' : 'Budget'}
      subtitle={periodMonth || undefined}
      right={
        <IconBtn
          d={expanded ? I.collapse : I.expand}
          size={22}
          title={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded((v) => !v)}
        />
      }
    >
      {expanded ? (
        <BudgetRows groups={usageGroups} budget={budget} />
      ) : (
        <div
          style={{
            padding: '10px 14px',
            fontSize: 12,
            color: 'var(--ink-2)',
            fontFamily: 'var(--f-mono)',
            cursor: 'pointer',
          }}
          onClick={() => setExpanded(true)}
        >
          {summaryLine}
        </div>
      )}
    </Panel>
  );
}

// =============================================================================
// Signals preview — scrollable signal cards for dashboard
// =============================================================================

const SIG_BORDER: Record<string, string> = {
  high: 'var(--clay)',
  medium: 'var(--sky)',
  low: 'var(--ink-5)',
  noise: 'var(--line-2)',
};

const SIG_PILL: Record<string, 'warn' | 'info' | 'n'> = {
  high: 'warn',
  medium: 'info',
  low: 'n',
  noise: 'n',
};

function SignalsPreviewPanel({
  signals,
  locale,
}: {
  signals: SignalTimelineEntry[];
  locale: 'en' | 'it';
}) {
  if (signals.length === 0) {
    return (
      <div style={{ padding: '20px 14px', fontSize: 12, color: 'var(--ink-5)', textAlign: 'center' }}>
        {locale === 'it'
          ? 'Nessun segnale rilevato negli ultimi 7 giorni.'
          : 'No signals detected in the last 7 days.'}
      </div>
    );
  }

  return (
    <div style={{ maxHeight: 260, overflow: 'auto' }}>
      {signals.slice(0, 8).map((s) => (
        <div
          key={s.id}
          style={{
            padding: '9px 14px',
            borderBottom: '1px solid var(--line)',
            borderLeft: `3px solid ${SIG_BORDER[s.significance] || 'var(--line-2)'}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Pill kind={SIG_PILL[s.significance] || 'n'} dot>
              {s.significance}
            </Pill>
            <span className="lp-mono" style={{ fontSize: 9, color: 'var(--ink-5)', textTransform: 'uppercase' }}>
              {s.type === 'ecosystem_alert' ? 'monitor' : 'watch'}
            </span>
            <span style={{ flex: 1 }} />
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              {formatTimeAgo(s.timestamp, locale)}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-2)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {s.headline}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon d={I.globe} size={9} />
            {s.source_label}
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function EmptyMetric({ locale }: { locale: 'en' | 'it' }) {
  return (
    <div
      className="lp-card"
      style={{
        padding: '12px 14px 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--ink-5)',
        fontSize: 11,
      }}
    >
      {locale === 'it' ? '— nessuna metrica' : '— no metric'}
    </div>
  );
}

function agentNameFromType(type: string): string {
  if (type.startsWith('ecosystem.competitors')) return 'Scout';
  if (type.startsWith('ecosystem.ip')) return 'Scout';
  if (type.startsWith('ecosystem.trends')) return 'Scout';
  if (type.startsWith('ecosystem.partnerships')) return 'Outreach';
  if (type.startsWith('ecosystem.hiring')) return 'Recruiter';
  if (type.startsWith('ecosystem.customer_sentiment')) return 'Listener';
  if (type.startsWith('ecosystem.social')) return 'Social';
  if (type === 'health') return 'Chief';
  return 'Agent';
}

function roleFromType(type: string): string {
  if (type.startsWith('ecosystem.')) return 'research';
  if (type === 'health') return 'ceo';
  return 'monitor';
}

function agentColor(name: string): string {
  const map: Record<string, string> = {
    Scout: '#7a8b4a',
    Chief: '#4a5a7a',
    Analyst: '#7a5a4a',
    Outreach: '#7a4a6a',
    Designer: '#4a7a7a',
    Recruiter: '#5a7a4a',
    Listener: '#4a6a7a',
    Social: '#6a4a7a',
    Agent: '#6b6558',
  };
  return map[name] || '#555';
}

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return url.slice(0, 40); }
}

function formatTimeAgo(iso: string, locale: 'en' | 'it'): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return iso.slice(11, 16);
  }
}

// =============================================================================
// Local style constants
// =============================================================================

const btnPrimary: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 12px 7px 11px',
  borderRadius: 'var(--r-m)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'var(--f-sans)',
  fontWeight: 500,
  textDecoration: 'none',
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
  fontFamily: 'var(--f-sans)',
  textDecoration: 'none',
};

const linkStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ink-4)',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  cursor: 'pointer',
  textDecoration: 'none',
};
