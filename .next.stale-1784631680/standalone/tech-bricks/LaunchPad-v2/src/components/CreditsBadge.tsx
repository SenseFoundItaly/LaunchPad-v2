'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import RechargeDialog from '@/components/credits/RechargeDialog';
import { OUT_OF_CREDITS_EVENT, type OutOfCreditsDetail } from '@/components/credits/recharge-events';

// The "+ 100 free credits" self-serve mint is a dev/E2E affordance, not a
// founder feature — gate it so it never renders in production. Next.js inlines
// process.env.NODE_ENV into the client bundle, so this is the same client-safe
// signal used elsewhere (e.g. ChatMessage's isDev). E2E_AUTH_ENABLED is
// server-only and not exposed to the client, so NODE_ENV is the right gate.
const SHOW_DEV_CREDIT_BUMP = process.env.NODE_ENV !== 'production';

/**
 * CreditsBadge — TopBar pill showing remaining monthly credits + soft daily anchor.
 *
 * Cached in TanStack under ['credits', projectId]. Invalidation happens via
 * the lp-*-changed event bridge (see QueryProvider + query-events.ts):
 *   lp-credits-changed → 'credits' topic
 *   lp-actions-changed → 'credits' topic (chat charges credits on every turn)
 *
 * The badge mounts in TopBar on every page, so caching means navigation no
 * longer re-fetches. The old 30s polling is dropped — chat already fires
 * lp-credits-changed after each charge, which is the only real-time
 * mutation source from this tab. Cross-tab/cron-driven changes will lag
 * until the user navigates, which is acceptable for a credits display.
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
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bumping, setBumping] = useState(false);
  // Recharge modal: opened by clicking the empty badge OR by the global
  // lp-out-of-credits event a 402 fires (chat send, skill run). The badge is
  // mounted in TopBar on every page, so it's the natural home for the dialog.
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const [rechargeRemaining, setRechargeRemaining] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: snap } = useQuery<CreditsSnapshot | null>({
    queryKey: ['credits', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/credits`, { cache: 'no-store' });
      const body = (await res.json()) as ApiResponse;
      if (!body.success || !body.data) return null;
      return body.data;
    },
  });

  // Deduction animation: when `remaining` drops (a turn / skill / apply charged
  // the balance), pop the chip — zoom in, the new number lands, zoom out — and
  // float a "−N" delta. The chat fires lp-actions-changed at turn end, which
  // invalidates the credits query, so this reacts on every charge.
  const chipRef = useRef<HTMLSpanElement>(null);
  const prevRemaining = useRef<number | null>(null);
  const [delta, setDelta] = useState<number | null>(null);
  const [popKey, setPopKey] = useState(0);
  useEffect(() => {
    const cur = snap?.remaining;
    if (typeof cur !== 'number') return;
    const prev = prevRemaining.current;
    prevRemaining.current = cur;
    if (prev == null || cur >= prev) return; // first load or a refill — no pop
    setDelta(prev - cur);
    setPopKey((k) => k + 1);
    // Imperative pop so it replays on every charge (a CSS class wouldn't
    // re-trigger without a remount, which would drop the dropdown + ref).
    chipRef.current?.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.18)', offset: 0.35 },
        { transform: 'scale(1)' },
      ],
      { duration: 480, easing: 'cubic-bezier(.34,1.56,.64,1)' },
    );
    const t = setTimeout(() => setDelta(null), 950);
    return () => clearTimeout(t);
  }, [snap?.remaining]);

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

  // Open the recharge modal when a metered action 402s (chat send / skill run).
  useEffect(() => {
    function onOutOfCredits(e: Event) {
      const detail = (e as CustomEvent<OutOfCreditsDetail>).detail ?? {};
      setRechargeRemaining(typeof detail.remaining === 'number' ? detail.remaining : 0);
      setOpen(false); // close the dropdown if it was open
      setRechargeOpen(true);
    }
    window.addEventListener(OUT_OF_CREDITS_EVENT, onOutOfCredits);
    return () => window.removeEventListener(OUT_OF_CREDITS_EVENT, onOutOfCredits);
  }, []);

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
        // Write the PATCH response straight into cache so the badge
        // updates without a roundtrip. The dispatch below also fires the
        // event bridge, which queues a background invalidate — by then
        // the cache already shows the right number.
        qc.setQueryData<CreditsSnapshot>(['credits', projectId], body.data);
        // CustomEvent with projectId in detail — the QueryProvider bridge
        // scopes invalidation per-project via this field. Bare Event would
        // flush every project's credits cache.
        window.dispatchEvent(
          new CustomEvent('lp-credits-changed', { detail: { projectId } }),
        );
      }
    } catch {
      // silent
    } finally {
      setBumping(false);
    }
  }

  // A successful recharge (free top-up) hands back the fresh balance — write it
  // straight into the cache so the badge updates instantly, then fire the
  // per-project bridge to reconcile in the background (same pattern as bump).
  function handleRecharged(snapshot: { remaining: number; total: number }) {
    qc.setQueryData<CreditsSnapshot>(['credits', projectId], (prev) =>
      prev
        ? {
            ...prev,
            remaining: snapshot.remaining,
            total: snapshot.total,
            credits_used: Math.max(0, snapshot.total - snapshot.remaining),
          }
        : prev,
    );
    window.dispatchEvent(new CustomEvent('lp-credits-changed', { detail: { projectId } }));
  }

  if (!snap) {
    // Still render the dialog so an lp-out-of-credits event (fired before the
    // snapshot resolves) can open it.
    return (
      <>
        <span
          className="lp-chip"
          style={{ background: 'var(--paper-2)', color: 'var(--ink-5)' }}
        >
          <span className="lp-dot" style={{ background: 'var(--ink-6)' }} />
          — credits
        </span>
        {rechargeOpen && (
          <RechargeDialog remaining={rechargeRemaining} onRecharged={handleRecharged} onClose={() => setRechargeOpen(false)} />
        )}
      </>
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

  // USD is internal metering, not a founder-facing unit — surfaced in the
  // dropdown only as a muted detail, and only when a real budget row exists.
  const showUsdDetail =
    Number.isFinite(snap.used_usd) && Number.isFinite(snap.cap_usd) && snap.cap_usd > 0;

  // Parse period_month (YYYY-MM) to find the reset date (1st of next month)
  const resetLabel = (() => {
    try {
      const [y, m] = snap.period_month.split('-').map(Number);
      const next = new Date(y, m, 1); // month is 0-indexed so m (1-indexed) = next month
      return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    } catch { return 'next month'; }
  })();

  return (
    <>
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Floating "−N" deduction, fades up above the chip on each charge. */}
      {delta != null && (
        <span
          key={popKey}
          className="lp-credit-delta"
          style={{
            position: 'absolute',
            top: -11,
            right: 6,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'var(--f-mono)',
            color: 'var(--clay)',
            pointerEvents: 'none',
            zIndex: 2,
          }}
        >
          −{delta}
        </span>
      )}
      <span
        ref={chipRef}
        className="lp-chip"
        onClick={() => setOpen(!open)}
        style={{ background: bg, color: fg, position: 'relative', overflow: 'hidden', cursor: 'pointer' }}
      >
        <span className="lp-dot" style={{ background: dot }} />
        {snap.remaining}/{snap.total} credits
        {/* "· N today" removed — the balance is the signal; the daily delta was
            header noise the founder asked to drop. */}
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
          {/* Credits are the only founder-facing money unit. The old
              "Budget: $X / $Y USD" line leaked the internal metering currency;
              the budget now reads in credits (same fields the pill uses) and
              absorbs the former "Monthly:" line, which showed the identical
              numbers. */}
          <div style={{ marginBottom: 4 }}>
            Budget: {snap.credits_used}/{snap.total} credits used
          </div>
          <div style={{ marginBottom: showUsdDetail ? 4 : 10 }}>
            Resets: {resetLabel}
          </div>
          {/* USD kept ONLY as a muted internal detail — the snapshot already
              carries it (no extra fetch); hidden when no budget row exists
              yet (cap_usd 0 would render a meaningless $0.00 / $0.00). */}
          {showUsdDetail && (
            <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--ink-5)' }}>
              ${snap.used_usd.toFixed(2)} / ${snap.cap_usd.toFixed(2)} USD — internal metering
            </div>
          )}
          {/* Deep-link to the full per-project usage & spend breakdown.
              Closing the dropdown on click keeps it from lingering over the
              navigation. */}
          <Link
            href={`/project/${projectId}/usage`}
            onClick={() => setOpen(false)}
            style={{
              display: 'block',
              marginBottom: SHOW_DEV_CREDIT_BUMP ? 10 : 0,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accent-ink)',
              textDecoration: 'none',
            }}
          >
            View usage &amp; spend →
          </Link>
          {/* Recharge — founder-facing. Opens the (payments-stubbed) recharge
              modal. Emphasized when the pool is empty. */}
          <button
            onClick={() => { setOpen(false); setRechargeRemaining(snap.remaining); setRechargeOpen(true); }}
            style={{
              width: '100%',
              padding: '8px 12px',
              marginBottom: SHOW_DEV_CREDIT_BUMP ? 8 : 0,
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
              background: empty ? 'var(--clay)' : 'var(--surface)',
              color: empty ? 'white' : 'var(--accent-ink)',
              border: empty ? 'none' : '1px solid var(--line)',
              transition: 'opacity 0.15s',
            }}
          >
            {empty ? 'Recharge credits' : 'Add credits'}
          </button>
          {/* Dev/E2E-only: self-serve credit mint must never reach founders. */}
          {SHOW_DEV_CREDIT_BUMP && (
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
                // charcoal on the peach accent (readable); white on the dark
                // terracotta out-of-credits state.
                color: empty ? '#fff' : 'var(--on-accent)',
                opacity: bumping ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {bumping ? 'Adding...' : '+ 100 free credits'}
            </button>
          )}
        </div>
      )}
    </div>
    {rechargeOpen && (
      <RechargeDialog remaining={rechargeRemaining} onRecharged={handleRecharged} onClose={() => setRechargeOpen(false)} />
    )}
    </>
  );
}
