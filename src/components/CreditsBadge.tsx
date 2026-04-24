'use client';

import { useEffect, useState } from 'react';

/**
 * CreditsBadge — TopBar pill showing remaining monthly credits + soft daily anchor.
 *
 * Polls /api/projects/{id}/credits every 30s and refetches on the
 * `lp-tasks-changed` window event (the same event TasksTab listens to, so
 * the badge ticks down right after a task is created or marked done).
 *
 * Color rules:
 *   remaining === 0 → clay (out of credits)
 *   remaining < 5  → accent (warning)
 *   else            → paper-2 (neutral)
 */

interface CreditsSnapshot {
  remaining: number;
  used_today: number;
  daily_cap: number;
  cap_usd: number;
  used_usd: number;
  period_month: string;
}

interface ApiResponse {
  success: boolean;
  data?: CreditsSnapshot;
  error?: string;
}

export function CreditsBadge({ projectId }: { projectId: string }) {
  const [snap, setSnap] = useState<CreditsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function refetch() {
      try {
        const res = await fetch(`/api/projects/${projectId}/credits`, { cache: 'no-store' });
        const body = (await res.json()) as ApiResponse;
        if (!cancelled && body.success && body.data) setSnap(body.data);
      } catch {
        // silent — badge just stays stale until next tick
      }
    }

    refetch();
    const interval = setInterval(refetch, 30_000);
    const onChange = () => refetch();
    window.addEventListener('lp-tasks-changed', onChange);
    window.addEventListener('lp-credits-changed', onChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('lp-tasks-changed', onChange);
      window.removeEventListener('lp-credits-changed', onChange);
    };
  }, [projectId]);

  if (!snap) {
    return (
      <span
        className="lp-chip"
        style={{ background: 'var(--paper-2)', color: 'var(--ink-5)' }}
      >
        <span className="lp-dot" style={{ background: 'var(--ink-6)' }} />
        — credits
      </span>
    );
  }

  const empty = snap.remaining <= 0;
  const low = !empty && snap.remaining < 5;

  const bg = empty
    ? 'var(--clay)'
    : low
    ? 'var(--accent-wash)'
    : 'var(--paper-2)';
  const fg = empty
    ? 'var(--paper)'
    : low
    ? 'var(--accent-ink)'
    : 'var(--ink-3)';
  const dot = empty
    ? 'var(--paper)'
    : low
    ? 'var(--accent-ink)'
    : 'var(--ink-4)';

  return (
    <span
      className="lp-chip"
      title="Resets monthly. Each task costs 1 credit."
      style={{ background: bg, color: fg }}
    >
      <span className="lp-dot" style={{ background: dot }} />
      {snap.remaining} credit{snap.remaining === 1 ? '' : 's'}
      <span style={{ opacity: 0.7 }}>·</span>
      <span style={{ opacity: 0.7 }}>
        today {snap.used_today}/{snap.daily_cap}
      </span>
    </span>
  );
}
