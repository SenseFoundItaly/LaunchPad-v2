'use client';

/**
 * Today — trimmed landing surface.
 *
 * Two panels: Recent briefs (top intelligence briefs) + Inbox (top pending
 * actions). Both deep-link to /actions — the unified Inbox is now the
 * canonical review surface after the Phase 1 consolidation.
 */

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import { StageCard } from '@/components/stages/StageCard';
import MonitorListPanel from '@/components/monitors/MonitorListPanel';

interface BriefRow {
  id: string;
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  entity_name: string | null;
  confidence: number;
  evidence_count: number;
  sources_consulted: number;
  created_at: string;
}

interface TimelinePayload {
  briefs: BriefRow[];
  window_days: number;
}

interface PendingAction {
  id: string;
  action_type: string;
  title: string;
  rationale: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low' | null;
  created_at: string;
}

export default function TodayPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  // Two independent queries — they cache separately and invalidate via the
  // event bridge (lp-actions-changed → actions+timeline topics, see
  // src/lib/query-events.ts). Splitting them lets a chat action update the
  // inbox panel without bouncing the timeline panel out of cache.
  const { data: timeline, isLoading: timelineLoading } = useQuery<TimelinePayload>({
    queryKey: ['timeline', projectId, 7],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/timeline?days=7`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error || 'Timeline fetch failed');
      return body.data as TimelinePayload;
    },
  });

  const { data: actionsList, isLoading: actionsLoading } = useQuery<PendingAction[]>({
    queryKey: ['actions', projectId, 'preview', 3],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/actions?status=pending,edited&limit=3`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.data?.actions)) return [];
      return body.data.actions as PendingAction[];
    },
  });

  const actions = actionsList ?? [];
  const loading = timelineLoading || actionsLoading;
  const briefs = timeline?.briefs.slice(0, 3) || [];
  // Unsliced count for the status bar — `briefs` above is capped at 3 for the
  // panel, which would under-report in the footer.
  const weekBriefs = timeline?.briefs.length ?? 0;

  return (
    <div className="lp-frame">
      <TopBar
        projectId={projectId}
        breadcrumb={['Project', 'Home']}
        right={
          <Pill kind={inboxBadge > 0 ? 'ok' : 'n'} dot={inboxBadge > 0}>
            {inboxBadge} pending
          </Pill>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="dashboard" inboxBadge={inboxBadge} />

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px 32px',
            background: 'var(--paper)',
          }}
        >
          <header style={{ marginBottom: 24 }}>
            <h1
              className="lp-serif"
              style={{ margin: 0, fontSize: 28, fontWeight: 400, letterSpacing: -0.6, lineHeight: 1.1 }}
            >
              {greeting()}.
            </h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--ink-4)' }}>
              {summarize(briefs.length, inboxBadge)}
            </p>
          </header>

          {loading && !timeline ? (
            <SkeletonRow />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
              <StageCard projectId={projectId} />
              <RecentBriefsPanel projectId={projectId} briefs={briefs} />
              <Panel
                label="Watchers"
                icon={I.signal}
                href={`/project/${projectId}/actions?lane=monitor`}
                hrefLabel="Open Inbox"
                empty={null}
              >
                <MonitorListPanel projectId={projectId} compact limit={4} title="" />
              </Panel>
              <InboxPanel projectId={projectId} actions={actions} totalCount={inboxBadge} />
            </div>
          )}
        </div>
      </div>

      {/* No invented runtime state here — this page only knows briefs (7-day
          timeline fetch) and pending actions, so the bar reports exactly that
          plus the watchers' documented weekly scan cadence. */}
      <StatusBar
        heartbeatLabel="watchers · weekly cadence"
        ctxLabel={`${weekBriefs} brief${weekBriefs === 1 ? '' : 's'} this week`}
        budget={`${inboxBadge} pending`}
      />
    </div>
  );
}

// =============================================================================
// Panels
// =============================================================================

// "Briefs" is the founder-facing term — signals are the monitor alerts that
// feed a brief, watchers are the monitors themselves. Keep the three distinct.
function RecentBriefsPanel({ projectId, briefs }: { projectId: string; briefs: BriefRow[] }) {
  return (
    <Panel
      label="Recent briefs"
      icon={I.signal}
      href={`/project/${projectId}/actions`}
      hrefLabel="Open Inbox"
      empty={briefs.length === 0 ? 'No briefs yet. The correlator runs weekly across your watchers — new briefs land in the Inbox.' : null}
    >
      {briefs.map((b) => (
        <Link
          key={b.id}
          href={`/project/${projectId}/actions`}
          style={{
            display: 'block',
            textDecoration: 'none',
            color: 'inherit',
            padding: '10px 12px',
            borderRadius: 6,
            transition: 'background .1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>
              {b.title}
            </span>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
              {humanAge(b.created_at)}
            </span>
          </div>
          {b.temporal_prediction && (
            <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 4 }}>
              <span
                className="lp-mono"
                style={{ fontSize: 9, color: 'var(--ink-5)', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 6 }}
              >
                Prediction
              </span>
              {b.temporal_prediction}
            </div>
          )}
          <div
            className="lp-mono"
            style={{ fontSize: 10, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <span>{b.evidence_count} signal{b.evidence_count === 1 ? '' : 's'}</span>
            {b.sources_consulted > 0 && <span>· {b.sources_consulted} source{b.sources_consulted === 1 ? '' : 's'}</span>}
            <span>· {(b.confidence * 100).toFixed(0)}% confidence</span>
          </div>
        </Link>
      ))}
    </Panel>
  );
}

function InboxPanel({
  projectId,
  actions,
  totalCount,
}: {
  projectId: string;
  actions: PendingAction[];
  totalCount: number;
}) {
  const extra = Math.max(0, totalCount - actions.length);
  return (
    <Panel
      label="Inbox"
      icon={I.tickets}
      href={`/project/${projectId}/actions`}
      hrefLabel={totalCount > 0 ? `View all (${totalCount})` : 'Open inbox'}
      empty={actions.length === 0 ? 'No pending actions. New proposals appear here as your watchers fire.' : null}
    >
      {actions.map((a) => (
        <Link
          key={a.id}
          href={`/project/${projectId}/actions`}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '8px 12px',
            borderRadius: 6,
            textDecoration: 'none',
            color: 'inherit',
            transition: 'background .1s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {a.priority && <PriorityDot priority={a.priority} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
              {a.title}
            </div>
            {a.rationale && (
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--ink-4)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 1,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {a.rationale}
              </div>
            )}
          </div>
          <span className="lp-mono" style={{ fontSize: 10, color: 'var(--ink-5)' }}>
            {humanAge(a.created_at)}
          </span>
        </Link>
      ))}
      {extra > 0 && (
        <Link
          href={`/project/${projectId}/actions`}
          style={{
            display: 'block',
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--ink-4)',
            textDecoration: 'none',
            fontFamily: 'var(--f-mono)',
          }}
        >
          +{extra} more in inbox
        </Link>
      )}
    </Panel>
  );
}

// =============================================================================
// Local primitives
// =============================================================================

function Panel({
  label,
  icon,
  href,
  hrefLabel,
  empty,
  children,
}: {
  label: string;
  icon: string;
  href: string;
  hrefLabel: string;
  empty: string | null;
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
          padding: '12px 16px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <Icon d={icon} size={13} stroke={1.4} style={{ color: 'var(--ink-3)' }} />
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
        <div style={{ flex: 1 }} />
        <Link
          href={href}
          style={{
            fontSize: 11,
            color: 'var(--ink-3)',
            textDecoration: 'none',
            fontFamily: 'var(--f-mono)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {hrefLabel}
          <Icon d={I.arrow} size={10} stroke={1.4} />
        </Link>
      </header>
      <div style={{ padding: 6 }}>
        {empty ? (
          <div
            style={{
              padding: '14px 12px',
              fontSize: 12,
              color: 'var(--ink-5)',
              textAlign: 'center',
              fontStyle: 'italic',
            }}
          >
            {empty}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function PriorityDot({ priority }: { priority: 'critical' | 'high' | 'medium' | 'low' }) {
  const color =
    priority === 'critical' ? 'var(--clay)' :
    priority === 'high' ? 'var(--clay)' :
    priority === 'medium' ? 'var(--ink-3)' :
    'var(--ink-5)';
  return (
    <span
      title={`Priority: ${priority}`}
      className="lp-dot"
      style={{ width: 7, height: 7, background: color, marginTop: 6, flexShrink: 0 }}
    />
  );
}

function SkeletonRow() {
  return (
    <div
      style={{
        padding: 24,
        textAlign: 'center',
        fontSize: 12,
        color: 'var(--ink-5)',
        fontFamily: 'var(--f-mono)',
      }}
    >
      Loading today…
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function summarize(briefs: number, inbox: number): string {
  const bits: string[] = [];
  if (briefs > 0) bits.push(`${briefs} recent brief${briefs === 1 ? '' : 's'}`);
  if (inbox > 0) bits.push(`${inbox} pending action${inbox === 1 ? '' : 's'}`);
  if (bits.length === 0) return 'Nothing pending right now.';
  return bits.join(' · ');
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
