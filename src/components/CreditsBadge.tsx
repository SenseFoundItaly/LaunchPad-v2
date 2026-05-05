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
  total: number;
  credits_used: number;
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

  const pct = snap.total > 0 ? Math.min(100, (snap.credits_used / snap.total) * 100) : 0;
  const barColor = empty ? 'var(--clay)' : low ? 'var(--accent)' : 'var(--moss)';

  // Parse period_month (YYYY-MM) to find the reset date (1st of next month)
  const resetLabel = (() => {
    try {
      const [y, m] = snap.period_month.split('-').map(Number);
      const next = new Date(y, m, 1); // month is 0-indexed so m (1-indexed) = next month
      return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    } catch { return 'next month'; }
  })();

  const tooltip = [
    `Monthly: ${snap.credits_used}/${snap.total} credits used`,
    `Today: ${snap.used_today} credits used`,
    `Budget: $${snap.used_usd.toFixed(2)} / $${snap.cap_usd.toFixed(2)} USD`,
    `Resets: ${resetLabel}`,
  ].join('\n');

  return (
    <span
      className="lp-chip"
      title={tooltip}
      style={{ background: bg, color: fg, position: 'relative', overflow: 'hidden' }}
    >
      <span className="lp-dot" style={{ background: dot }} />
      {snap.remaining}/{snap.total} credits
      <span style={{ opacity: 0.7 }}>·</span>
      <span style={{ opacity: 0.7 }}>
        {snap.used_today} today
      </span>
      {/* Micro progress bar */}
      <span
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 2,
          width: `${pct}%`,
          background: barColor,
          borderRadius: '0 1px 0 0',
          transition: 'width 0.3s ease',
        }}
      />
    </span>
  );
}
