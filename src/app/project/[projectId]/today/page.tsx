'use client';

/**
 * Today — the new lightweight project landing.
 *
 * Three panels, no kitchen-sink:
 *   1. Briefs   — top 3 active intelligence briefs (deep links to /signals)
 *   2. Inbox    — top 3 pending actions (deep links to /actions)
 *   3. Pulse    — last-24h counts per topic with one-click drill-in
 *
 * Replaces the 1850-LOC /dashboard as the project root. The dashboard URL
 * still works (no redirect), but nothing in the nav points to it anymore.
 */

import { use, useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { TopBar, NavRail } from '@/components/design/chrome';
import { Pill, StatusBar, Icon, I } from '@/components/design/primitives';
import { useOpenActionCount } from '@/hooks/useOpenActionCount';
import type { Watcher, WatcherTopic } from '@/lib/watchers';

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

interface FindingRow {
  id: string;
  kind: 'finding' | 'change';
  watcher_name: string | null;
  topic: WatcherTopic | null;
  headline: string;
  brief_id: string | null;
  created_at: string;
}

interface TimelinePayload {
  briefs: BriefRow[];
  findings: FindingRow[];
  watchers: Watcher[];
  topic_counts: Record<string, number>;
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

const TOPIC_LABELS: Record<string, string> = {
  competitors: 'Competitors',
  ip: 'Patents & IP',
  trends: 'Trends',
  partnerships: 'Partnerships',
  hiring: 'Hiring',
  sentiment: 'Sentiment',
  funding: 'Funding',
  regulatory: 'Regulatory',
  pricing: 'Pricing',
  custom: 'Custom',
};

export default function TodayPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { count: inboxBadge } = useOpenActionCount(projectId);

  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [timelineRes, actionsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/timeline?days=7`),
        fetch(`/api/projects/${projectId}/actions?status=pending,edited&limit=3`),
      ]);
      const timelineBody = await timelineRes.json();
      const actionsBody = await actionsRes.json();
      if (timelineBody.success) setTimeline(timelineBody.data as TimelinePayload);
      if (actionsBody.success && Array.isArray(actionsBody.data?.actions)) {
        setActions(actionsBody.data.actions as PendingAction[]);
      }
    } catch {
      /* partial state ok */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const briefs = timeline?.briefs.slice(0, 3) || [];
  const findings = timeline?.findings || [];
  const watchers = timeline?.watchers || [];
  const last24h = countLast24h(findings);

  return (
    <div className="lp-frame">
      <TopBar
        breadcrumb={['Project', 'Today']}
        right={
          <Pill kind={watchers.length > 0 ? 'ok' : 'n'} dot={watchers.length > 0}>
            {watchers.length} watcher{watchers.length === 1 ? '' : 's'}
          </Pill>
        }
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <NavRail projectId={projectId} current="today" inboxBadge={inboxBadge} />

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '24px 32px',
            background: 'var(--paper)',
          }}
        >
          {/* Greeting */}
          <header style={{ marginBottom: 24 }}>
            <h1
              className="lp-serif"
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 400,
                letterSpacing: -0.6,
                lineHeight: 1.1,
              }}
            >
              {greeting()}.
            </h1>
            <p
              style={{
                margin: '6px 0 0',
                fontSize: 13,
                color: 'var(--ink-4)',
              }}
            >
              {summarize(last24h, inboxBadge, briefs.length)}
            </p>
          </header>

          {loading && !timeline ? (
            <SkeletonRow />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 880 }}>
              <BriefsPanel projectId={projectId} briefs={briefs} />
              <InboxPanel projectId={projectId} actions={actions} totalCount={inboxBadge} />
              <PulsePanel
                projectId={projectId}
                topicCounts={timeline?.topic_counts || {}}
                last24h={last24h}
                window={timeline?.window_days || 7}
              />
            </div>
          )}
        </div>
      </div>

      <StatusBar
        heartbeatLabel="heartbeat · idle"
        gateway="pi-agent · anthropic"
        ctxLabel={`${briefs.length} briefs · ${last24h} signals 24h`}
        budget={`${watchers.length} watchers`}
      />
    </div>
  );
}

// =============================================================================
// Panels
// =============================================================================

function BriefsPanel({ projectId, briefs }: { projectId: string; briefs: BriefRow[] }) {
  return (
    <Panel
      label="Briefs"
      icon={I.sparkles}
      href={`/project/${projectId}/signals`}
      hrefLabel="View all signals"
      empty={briefs.length === 0 ? 'No briefs yet. The correlator runs weekly across your watchers.' : null}
    >
      {briefs.map((b) => (
        <Link
          key={b.id}
          href={`/project/${projectId}/signals`}
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
                style={{
                  fontSize: 9,
                  color: 'var(--ink-5)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                  marginRight: 6,
                }}
              >
                Prediction
              </span>
              {b.temporal_prediction}
            </div>
          )}
          <div
            className="lp-mono"
            style={{
              fontSize: 10,
              color: 'var(--ink-5)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
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
      empty={actions.length === 0 ? 'No pending actions. New proposals appear here as monitors fire.' : null}
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
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--ink)',
                lineHeight: 1.3,
              }}
            >
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

function PulsePanel({
  projectId,
  topicCounts,
  last24h,
  window,
}: {
  projectId: string;
  topicCounts: Record<string, number>;
  last24h: number;
  window: number;
}) {
  const topics = Object.entries(topicCounts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Panel
      label="Pulse"
      icon={I.signal}
      href={`/project/${projectId}/signals`}
      hrefLabel={`See ${window}d feed`}
      empty={topics.length === 0 ? 'No watchers active yet — head to Signals to set some up.' : null}
    >
      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 500,
            color: 'var(--ink)',
            fontFamily: 'var(--f-serif)',
            letterSpacing: -0.4,
          }}
        >
          {last24h} <span style={{ fontSize: 12, color: 'var(--ink-4)', fontFamily: 'var(--f-mono)' }}>signal{last24h === 1 ? '' : 's'} last 24h</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {topics.map(([topic, n]) => (
            <Link
              key={topic}
              href={`/project/${projectId}/signals`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                background: 'var(--paper-2)',
                border: '1px solid var(--line)',
                borderRadius: 12,
                fontSize: 11,
                color: 'var(--ink-3)',
                textDecoration: 'none',
                fontFamily: 'var(--f-mono)',
              }}
            >
              <span>{TOPIC_LABELS[topic] || topic}</span>
              <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{n}</span>
            </Link>
          ))}
        </div>
      </div>
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
      style={{
        width: 7,
        height: 7,
        background: color,
        marginTop: 6,
        flexShrink: 0,
      }}
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

function summarize(last24h: number, inbox: number, briefs: number): string {
  const bits: string[] = [];
  if (briefs > 0) bits.push(`${briefs} brief${briefs === 1 ? '' : 's'}`);
  if (last24h > 0) bits.push(`${last24h} new signal${last24h === 1 ? '' : 's'}`);
  if (inbox > 0) bits.push(`${inbox} pending action${inbox === 1 ? '' : 's'}`);
  if (bits.length === 0) return 'Nothing moving since you last looked.';
  return `Since yesterday: ${bits.join(', ')}.`;
}

function countLast24h(findings: FindingRow[]): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return findings.filter((f) => new Date(f.created_at).getTime() >= cutoff).length;
}

function humanAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
