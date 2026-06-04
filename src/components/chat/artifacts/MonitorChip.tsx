'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Icon, I } from '@/components/design/icons';

interface MonitorStatus {
  watching: boolean;
  monitor_type?: string;
  last_fired_at?: string | null;
  last_headline?: string | null;
}

interface MonitorChipProps {
  /** The entity identifier to look up. Pass the artifact id or, for
   *  entity-cards without a stable persisted id, the entity name. */
  entityId: string | undefined | null;
}

/**
 * Small bell-icon chip that surfaces monitor activity on the artifact it's
 * attached to. Renders nothing when no monitor is wired up, when the lookup
 * fails, or while loading — the parent card must remain useful in all those
 * cases. Wired into entity-card and risk-matrix renderers so founders see
 * "watching · last fired ..." right where the work lives, not in a separate
 * alerts panel.
 */
export default function MonitorChip({ entityId }: MonitorChipProps) {
  const params = useParams<{ projectId?: string }>();
  const projectId = params?.projectId;
  const [status, setStatus] = useState<MonitorStatus | null>(null);

  useEffect(() => {
    if (!projectId || !entityId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/projects/${projectId}/monitor-status?entity_id=${encodeURIComponent(entityId)}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled) return;
        const data = (body?.data ?? body) as MonitorStatus;
        if (data?.watching) setStatus(data);
      } catch {
        // Silent fail — chip is a progressive enhancement, never a blocker.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, entityId]);

  if (!status?.watching) return null;

  return (
    <span
      title={status.last_headline ?? 'Monitor active'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 'var(--r-s, 6px)',
        background: 'var(--accent-wash)',
        color: 'var(--accent-ink, var(--accent))',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: 1.3,
        maxWidth: 280,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      <Icon d={I.bell} size={11} />
      <span>watching</span>
      {(status.last_fired_at || status.last_headline) && (
        <span style={{ color: 'var(--ink-4)' }}>
          {' · '}
          {status.last_fired_at && <>last fired {formatRelative(status.last_fired_at)}</>}
          {status.last_headline && (
            <>
              {status.last_fired_at ? ': ' : ''}
              {status.last_headline}
            </>
          )}
        </span>
      )}
    </span>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}
