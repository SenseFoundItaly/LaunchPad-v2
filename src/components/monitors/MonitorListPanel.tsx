'use client';

/**
 * WatcherListPanel (filename still MonitorListPanel.tsx + export
 * preserved for backward compat with existing imports).
 *
 * Founder-facing list of "watchers" — the unified primitive over the two
 * underlying implementations: LLM-scan (the `monitors` table) and URL-diff
 * (the `watch_sources` table). The founder sees ONE concept; the row's type
 * pill ("Topic" or "URL") names the flavor without leaking the table split.
 *
 * Two render modes, driven by the `compact` prop:
 *   - compact: bare rows only (rendered INSIDE an existing Panel on /today,
 *     capped by `limit`, no title, no CTA).
 *   - full: own heading + "+ New watcher" CTA + own scroll (/actions lane).
 *
 * Data: GET /api/projects/:projectId/watchers — unified read endpoint over
 * monitors + watch_sources. The legacy /monitors endpoint stays for the
 * detail page; this list now shows BOTH flavors. Proposed-not-yet-approved
 * watchers live in the inbox (configure_monitor / configure_watch_source
 * pending_actions) — out of this panel's scope.
 *
 * Iter-3.5 unification: replaces the prior monitor-only view that hid the
 * URL-diff watch_sources from the founder.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import Link from 'next/link';
import { Pill, Icon, I } from '@/components/design/primitives';
import type { Watcher } from '@/lib/watchers';

function relAge(iso: string | null): string {
  if (!iso) return 'never run';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.round(days / 7)}w ago`;
}

function statusPill(status: string) {
  if (status === 'active') return <Pill kind="ok" dot>active</Pill>;
  if (status === 'paused') return <Pill kind="n">paused</Pill>;
  if (status === 'error') return <Pill kind="warn">error</Pill>;
  if (status === 'archived') return <Pill kind="n">archived</Pill>;
  return <Pill kind="n">{status}</Pill>;
}

/** Iter-3.5: founder-facing type pill. "URL" = watch_source (URL diff),
 *  "Topic" = monitor (LLM scan). Hides the implementation detail behind a
 *  single-word label that explains what's being watched without naming
 *  which table it lives in. */
function kindPill(kind: string) {
  if (kind === 'diff') return <Pill kind="n">URL</Pill>;
  if (kind === 'scan') return <Pill kind="n">Topic</Pill>;
  if (kind === 'hybrid') return <Pill kind="n">Mixed</Pill>;
  return null;
}

function WatcherRow({ projectId, w }: { projectId: string; w: Watcher }) {
  // Detail page is keyed off the underlying monitor id only (legacy route).
  // Watch_source rows don't have a detail page yet — link to /actions where
  // the row exists in the inbox lane.
  const href = w._origin === 'monitor'
    ? `/project/${projectId}/monitors/${w._origin_id}`
    : `/project/${projectId}/actions`;

  return (
    <Link
      href={href}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 6,
        textDecoration: 'none',
        color: 'inherit',
        transition: 'background .1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--paper-2)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {w.name}
          </span>
          {kindPill(w.kind)}
          {statusPill(w.status)}
        </div>
        <div
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <span>{w.cadence}</span>
          <span>· {relAge(w.last_run_at)}</span>
          {w.recent_finding_count > 0 && (
            <span>· {w.recent_finding_count} signal{w.recent_finding_count === 1 ? '' : 's'} / 7d</span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default function MonitorListPanel({
  projectId,
  compact = false,
  limit,
  title = 'Watchers',
}: {
  projectId: string;
  compact?: boolean;
  limit?: number;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<Watcher[]>({
    queryKey: ['watchers', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      // Iter-3.5: hit the unified /watchers endpoint (returns monitors +
      // watch_sources merged behind the Watcher type). The legacy /monitors
      // route stays for the detail page; this list shows BOTH flavors so
      // the founder sees one list of things being watched.
      const res = await fetch(`/api/projects/${projectId}/watchers`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.data)) return [];
      return body.data as Watcher[];
    },
  });

  // Iter-3 QA fix: invalidate the watchers query when actions change.
  // When the founder approves a proposed watcher in /actions, the
  // pending_action transitions and a new monitor / watch_source row
  // materializes — but this component cached its list under
  // ['watchers', projectId] and had no listener, leaving the panel stale
  // until a manual refresh. Wired the same way Canvas.tsx listens to facts.
  useEffect(() => {
    if (!projectId) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['watchers', projectId] });
    };
    window.addEventListener('lp-actions-changed', handler);
    return () => window.removeEventListener('lp-actions-changed', handler);
  }, [projectId, queryClient]);

  const all = data ?? [];
  const rows = typeof limit === 'number' ? all.slice(0, limit) : all;

  const newWatcherCta = (
    <Link
      href={`/project/${projectId}/chat`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        color: 'var(--accent-ink)',
        background: 'var(--accent-wash)',
        padding: '6px 10px',
        borderRadius: 6,
        textDecoration: 'none',
      }}
    >
      <Icon d={I.plus} size={13} /> New watcher
    </Link>
  );

  // ---- compact: bare rows, no chrome (parent Panel owns the heading) -------
  if (compact) {
    if (isLoading) return <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 12px' }}>Loading watchers…</div>;
    if (rows.length === 0) {
      return <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 12px' }}>No active watchers yet.</div>;
    }
    return <div>{rows.map((w) => <WatcherRow key={w.id} projectId={projectId} w={w} />)}</div>;
  }

  // ---- full: heading + CTA + list ------------------------------------------
  return (
    <div style={{ padding: '16px 20px', maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Icon d={I.signal} size={16} />
        {title && (
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>
            {title}
            {all.length > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--ink-5)', marginLeft: 8 }}>{all.length}</span>
            )}
          </h2>
        )}
        {!title && <div style={{ flex: 1 }} />}
        {newWatcherCta}
      </div>

      {isLoading ? (
        <div style={{ fontSize: 13, color: 'var(--ink-5)', padding: '24px 12px', textAlign: 'center' }}>
          Loading watchers…
        </div>
      ) : isError ? (
        <div style={{ fontSize: 13, color: 'var(--clay)', padding: '24px 12px', textAlign: 'center' }}>
          Could not load watchers. Refresh to retry.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '28px 16px', textAlign: 'center', lineHeight: 1.5 }}>
          No watchers yet. Ask the co-pilot to watch a competitor, market, or risk —
          it proposes a weekly watcher you approve, then it runs on schedule and
          drops signals into your Inbox.
        </div>
      ) : (
        <div>{rows.map((w) => <WatcherRow key={w.id} projectId={projectId} w={w} />)}</div>
      )}
    </div>
  );
}
