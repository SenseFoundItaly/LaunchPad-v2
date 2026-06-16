'use client';

/**
 * RechargeDialog — modal shown when a founder runs out of credits.
 *
 * Opens when a metered action gets a 402 `out_of_credits` (chat send, skill
 * run) or when the founder clicks the empty CreditsBadge. Presents a few credit
 * packs and a Recharge button that POSTs to /api/credits/recharge.
 *
 * PAYMENTS NOT INTEGRATED YET (founder decision 2026-06-16). Until Stripe lands
 * the recharge route grants the chosen pack for FREE — so the modal is a real,
 * working exit from the hard-stop (remaining 0 → recharge → cap grows → keep
 * going), not a dead end. The pack rows show "Free during beta" instead of
 * dollar amounts so nothing misleading ships. On success the dialog reports the
 * new balance and hands the fresh snapshot back via `onRecharged` so the badge
 * updates without a refetch. The legacy `checkout_url` / `payments_not_integrated`
 * branches are kept so flipping on Stripe later needs no client change.
 *
 * Styling follows the inline CSS-var design system (see AddDocumentsDialog).
 */

import { useEffect, useState } from 'react';
import { Icon, I } from '@/components/design/primitives';
import { notifyRecharged } from '@/components/credits/recharge-events';

/** Placeholder credit packs — pricing intentionally TBD until payments land.
 *  `id` is what the recharge route will map to a server-side price; never trust
 *  a client-sent price. */
export interface CreditPack {
  id: string;
  credits: number;
  /** Optional marketing label (e.g. "Most popular"). */
  badge?: string;
}

const DEFAULT_PACKS: CreditPack[] = [
  { id: 'pack_100', credits: 100 },
  { id: 'pack_500', credits: 500, badge: 'Most popular' },
  { id: 'pack_1000', credits: 1000, badge: 'Best value' },
];

export interface RechargeDialogProps {
  onClose: () => void;
  /** Remaining credits at the time the dialog opened (usually 0). */
  remaining?: number;
  /** Override the packs (defaults to the 100 / 500 / 1000 placeholders). */
  packs?: CreditPack[];
  /** Called with the fresh credit snapshot after a successful top-up, so the
   *  badge can update its cache without an extra fetch. */
  onRecharged?: (snapshot: { remaining: number; total: number }) => void;
}

type Phase = 'choose' | 'submitting' | 'success' | 'unavailable' | 'error';

export default function RechargeDialog({ onClose, remaining = 0, packs = DEFAULT_PACKS, onRecharged }: RechargeDialogProps) {
  const [phase, setPhase] = useState<Phase>('choose');
  const [selected, setSelected] = useState<string>(packs[1]?.id ?? packs[0]?.id ?? '');
  const [message, setMessage] = useState<string>('');
  const [addedCredits, setAddedCredits] = useState<number>(0);

  // Esc closes (except mid-submit, to avoid orphaning a future real payment).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'submitting') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  async function handleRecharge() {
    const pack = packs.find((p) => p.id === selected);
    if (!pack) return;
    setPhase('submitting');
    setMessage('');
    try {
      const res = await fetch('/api/credits/recharge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack_id: pack.id, credits: pack.credits }),
      });
      const body = await res.json().catch(() => null);
      // Legacy payments stub: 501 { error:'payments_not_integrated' }. Kept so
      // the dialog still behaves if the route is ever reverted to the stub.
      if (body?.error === 'payments_not_integrated') {
        setMessage(body?.message ?? 'Recharge is not available yet — payments are coming soon.');
        setPhase('unavailable');
        return;
      }
      // Future Stripe path: { success:true, data:{ checkout_url } } → redirect.
      if (res.ok && body?.success && body?.data?.checkout_url) {
        window.location.href = body.data.checkout_url as string;
        return;
      }
      // Free top-up (current): { success:true, data: <CreditsSnapshot> }. Hand
      // the fresh snapshot to the badge and show a success state.
      if (res.ok && body?.success && typeof body?.data?.remaining === 'number') {
        setAddedCredits(pack.credits);
        onRecharged?.({ remaining: body.data.remaining, total: body.data.total });
        // Let any flow blocked by a 402 resume (useChat re-sends the dropped
        // message; skill-run cards become runnable again).
        notifyRecharged({ remaining: body.data.remaining });
        setPhase('success');
        return;
      }
      setMessage(body?.error ?? `Recharge failed (HTTP ${res.status}).`);
      setPhase('error');
    } catch (e) {
      setMessage((e as Error).message || 'Recharge failed.');
      setPhase('error');
    }
  }

  const submitting = phase === 'submitting';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Recharge credits"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(20,18,16,0.42)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-l)',
          boxShadow: '0 24px 60px rgba(20,18,16,0.30)', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--clay)', flexShrink: 0 }} />
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
            {remaining > 0 ? 'Add credits' : 'Out of credits'}
          </h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--ink-5)', lineHeight: 0 }}
          >
            <Icon d={I.x} size={15} stroke={1.6} />
          </button>
        </header>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
          {(phase === 'choose' || phase === 'submitting' || phase === 'error') && (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '0 0 14px', lineHeight: 1.5 }}>
                {remaining > 0
                  ? 'Top up your monthly pool to keep going.'
                  : "You've used all your credits for this month. Recharge to keep going, or wait for next month's reset."}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {packs.map((pack) => {
                  const checked = pack.id === selected;
                  return (
                    <button
                      key={pack.id}
                      onClick={() => setSelected(pack.id)}
                      disabled={submitting}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
                        padding: '11px 13px', cursor: submitting ? 'default' : 'pointer',
                        border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                        background: checked ? 'var(--accent-wash, var(--paper-2))' : 'var(--surface)',
                        borderRadius: 'var(--r-m)',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 16, height: 16, flexShrink: 0, borderRadius: '50%',
                          border: `1.5px solid ${checked ? 'var(--accent)' : 'var(--line)'}`,
                          background: checked ? 'var(--accent)' : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
                        }}
                      >
                        {checked && <Icon d={I.check} size={10} stroke={2.4} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
                            {pack.credits.toLocaleString()} credits
                          </span>
                          {pack.badge && (
                            <span
                              className="lp-mono"
                              style={{
                                fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.4,
                                color: 'var(--accent-ink, var(--accent))', border: '1px solid var(--line)',
                                borderRadius: 4, padding: '1px 5px',
                              }}
                            >
                              {pack.badge}
                            </span>
                          )}
                        </span>
                        {/* Free while payments aren't wired (founder decision
                            2026-06-16) — real pricing lands with Stripe. */}
                        <span className="lp-mono" style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-5)', marginTop: 2 }}>
                          Free during beta
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {phase === 'error' && message && (
                <div style={{ fontSize: 11.5, color: 'var(--clay)', background: 'rgba(180,80,40,0.08)', border: '1px solid rgba(180,80,40,0.3)', borderRadius: 6, padding: '7px 9px', marginTop: 12 }}>
                  {message}
                </div>
              )}
            </>
          )}

          {phase === 'success' && (
            <div style={{ textAlign: 'center', padding: '20px 8px' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent)', color: '#fff' }}>
                <Icon d={I.check} size={18} stroke={2.2} />
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>
                {addedCredits.toLocaleString()} credits added
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 5, lineHeight: 1.5 }}>
                Free during beta — you can pick up right where you left off.
              </div>
            </div>
          )}

          {phase === 'unavailable' && (
            <div style={{ textAlign: 'center', padding: '20px 8px' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', margin: '0 auto 12px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--paper-2)', color: 'var(--ink-3)' }}>
                <Icon d={I.clock} size={18} stroke={1.8} />
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600 }}>Coming soon</div>
              <div style={{ fontSize: 12, color: 'var(--ink-5)', marginTop: 5, lineHeight: 1.5 }}>
                {message || 'Recharge is not available yet — payments are coming soon. Your credits reset at the start of next month.'}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderTop: '1px solid var(--line)', background: 'var(--paper-2)' }}>
          <div style={{ flex: 1 }} />
          {phase === 'success' ? (
            <button onClick={onClose} style={btnPrimary}>Done</button>
          ) : phase === 'unavailable' ? (
            <button onClick={onClose} style={btnPrimary}>Got it</button>
          ) : (
            <>
              <button onClick={onClose} disabled={submitting} style={{ ...btnGhost, opacity: submitting ? 0.5 : 1 }}>
                Cancel
              </button>
              <button onClick={handleRecharge} disabled={submitting || !selected} style={{ ...btnPrimary, opacity: submitting || !selected ? 0.6 : 1 }}>
                {submitting ? 'Working…' : 'Recharge'}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: '#fff', background: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 'var(--r-m)', padding: '7px 13px', cursor: 'pointer' };
const btnGhost: React.CSSProperties = { fontSize: 12.5, color: 'var(--ink-2)', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--r-m)', padding: '7px 13px', cursor: 'pointer' };
