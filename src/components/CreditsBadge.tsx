'use client';

import { useEffect, useState, useRef } from 'react';

/**
 * CreditsBadge — TopBar pill showing remaining monthly credits + soft daily anchor.
 *
 * Polls /api/projects/{id}/credits every 30s and refetches on the
 * `lp-tasks-changed` / `lp-credits-changed` window events.
 *
 * Clicking the badge opens a dropdown with usage details and a button
 * to bump +100 free credits (calls PATCH /api/projects/{id}/credits).
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
  const [open, setOpen] = useState(false);
  const [bumping, setBumping] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Click-outside to close dropdown
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  async function handleBump() {
    setBumping(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/credits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bump' }),
      });
      const body = (await res.json()) as ApiResponse;
      if (body.success && body.data) {
        setSnap(body.data);
        window.dispatchEvent(new Event('lp-credits-changed'));
      }
    } catch {
      // silent
    } finally {
      setBumping(false);
    }
  }

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

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <span
        className="lp-chip"
        onClick={() => setOpen(!open)}
        style={{ background: bg, color: fg, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
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

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--paper)',
            border: '1px solid var(--ink-8)',
            borderRadius: 8,
            padding: '12px 16px',
            minWidth: 220,
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 100,
            fontSize: 13,
            color: 'var(--ink-2)',
          }}
        >
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Credits</div>
          <div style={{ marginBottom: 4 }}>
            Monthly: {snap.credits_used}/{snap.total} used
          </div>
          <div style={{ marginBottom: 4 }}>
            Budget: ${snap.used_usd.toFixed(2)} / ${snap.cap_usd.toFixed(2)} USD
          </div>
          <div style={{ marginBottom: 10 }}>
            Resets: {resetLabel}
          </div>
          <button
            onClick={handleBump}
            disabled={bumping}
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: 'none',
              cursor: bumping ? 'wait' : 'pointer',
              fontWeight: 600,
              fontSize: 13,
              background: empty ? 'var(--clay)' : 'var(--accent)',
              color: 'white',
              opacity: bumping ? 0.6 : 1,
              transition: 'opacity 0.15s',
            }}
          >
            {bumping ? 'Adding...' : '+ 100 free credits'}
          </button>
        </div>
      )}
    </div>
  );
}
