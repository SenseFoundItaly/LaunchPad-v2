'use client';

/**
 * UI event that asks the (always-mounted) CreditsBadge to open the
 * RechargeDialog. Dispatched when a metered action gets an HTTP 402
 * `out_of_credits` (chat send, skill run). Kept separate from the
 * lp-*-changed TanStack invalidation bridge (query-events.ts): this is a
 * UI-open signal, not a cache flush.
 *
 * The badge owns the dialog so the modal works on every page without each
 * surface threading dialog state through its own tree.
 */

export const OUT_OF_CREDITS_EVENT = 'lp-out-of-credits';

export interface OutOfCreditsDetail {
  /** Remaining credits reported by the 402 body (usually 0). */
  remaining?: number;
}

/** Fire the open-recharge signal. Safe to call from anywhere client-side. */
export function requestRecharge(detail: OutOfCreditsDetail = {}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<OutOfCreditsDetail>(OUT_OF_CREDITS_EVENT, { detail }));
}
