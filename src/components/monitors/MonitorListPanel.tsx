'use client';

/**
 * MonitorListPanel — the monitors list view.
 *
 * Two render modes, driven by the `compact` prop:
 *   - compact: bare rows only (rendered INSIDE an existing Panel on /today,
 *     capped by `limit`, no title, no CTA).
 *   - full: own heading + "+ New monitor" CTA + its own scroll (the /actions
 *     monitor lane).
 *
 * Data: GET /api/projects/:projectId/monitors returns active monitors AND
 * synthetic `proposal:` rows (agent-suggested, awaiting founder approval),
 * proposed first. Active rows deep-link to the detail page; proposed rows
 * deep-link to the Approvals lane so the founder can act on them. New monitors
 * are created by the co-pilot via propose_monitor, so the CTA opens chat.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import Link from 'next/link';
import { Pill, Icon, I } from '@/components/design/primitives';

interface Monitor {
  id: string;
  pending_action_id?: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  status: 'active' | 'paused' | 'proposed' | string;
  last_run: string | null;
  next_run: string | null;
  runs_7d: number;
  alerts_7d: number;
  created_at: string;
}

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
  if (status === 'proposed') return <Pill kind="info" dot>proposed</Pill>;
  if (status === 'paused') return <Pill kind="n">paused</Pill>;
  return <Pill kind="n">{status}</Pill>;
}

function MonitorRow({ projectId, m }: { projectId: string; m: Monitor }) {
  const isProposed = m.status === 'proposed';
  const href = isProposed && m.pending_action_id
    ? `/project/${projectId}/actions?lane=approval&action=${m.pending_action_id}`
    : `/project/${projectId}/monitors/${m.id}`;

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
            {m.name}
          </span>
          {statusPill(m.status)}
        </div>
        <div
          className="lp-mono"
          style={{ fontSize: 10, color: 'var(--ink-5)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <span>{m.schedule}</span>
          {!isProposed && <span>· {relAge(m.last_run)}</span>}
          {m.alerts_7d > 0 && <span>· {m.alerts_7d} alert{m.alerts_7d === 1 ? '' : 's'} / 7d</span>}
          {isProposed && <span>· awaiting approval</span>}
        </div>
      </div>
    </Link>
  );
}

export default function MonitorListPanel({
  projectId,
  compact = false,
  limit,
  title = 'Monitors',
}: {
  projectId: string;
  compact?: boolean;
  limit?: number;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<Monitor[]>({
    queryKey: ['monitors', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/monitors`);
      const body = await res.json();
      if (!body.success || !Array.isArray(body.data)) return [];
      return body.data as Monitor[];
    },
  });

  // Iter-3 QA fix: invalidate the monitors query when actions change.
  // When the founder approves a proposed monitor in /actions, the
  // pending_action transitions and a new monitor row materializes — but
  // this component cached its list under ['monitors', projectId] and had
  // no listener, leaving the panel showing the old "proposed" row until
  // a manual refresh. Wired the same way Canvas.tsx listens to facts.
  useEffect(() => {
    if (!projectId) return;
    const handler = () => {
      queryClient.invalidateQueries({ queryKey: ['monitors', projectId] });
    };
    window.addEventListener('lp-actions-changed', handler);
    return () => window.removeEventListener('lp-actions-changed', handler);
  }, [projectId, queryClient]);

  const all = data ?? [];
  const rows = typeof limit === 'number' ? all.slice(0, limit) : all;

  const newMonitorCta = (
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
      <Icon d={I.plus} size={13} /> New monitor
    </Link>
  );

  // ---- compact: bare rows, no chrome (parent Panel owns the heading) -------
  if (compact) {
    if (isLoading) return <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 12px' }}>Loading monitors…</div>;
    if (rows.length === 0) {
      return <div style={{ fontSize: 12, color: 'var(--ink-5)', padding: '8px 12px' }}>No active monitors yet.</div>;
    }
    return <div>{rows.map((m) => <MonitorRow key={m.id} projectId={projectId} m={m} />)}</div>;
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
        {newMonitorCta}
      </div>

      {isLoading ? (
        <div style={{ fontSize: 13, color: 'var(--ink-5)', padding: '24px 12px', textAlign: 'center' }}>
          Loading monitors…
        </div>
      ) : isError ? (
        <div style={{ fontSize: 13, color: 'var(--clay)', padding: '24px 12px', textAlign: 'center' }}>
          Could not load monitors. Refresh to retry.
        </div>
      ) : rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-4)', padding: '28px 16px', textAlign: 'center', lineHeight: 1.5 }}>
          No monitors yet. Ask the co-pilot to watch a competitor, market, or risk —
          it proposes a weekly monitor you approve, then it runs on schedule and drops
          signals into your Inbox.
        </div>
      ) : (
        <div>{rows.map((m) => <MonitorRow key={m.id} projectId={projectId} m={m} />)}</div>
      )}
    </div>
  );
}
