import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';
import { bumpUserCredits } from '@/lib/credits';

/**
 * POST /api/credits/recharge — FREE self-serve top-up (INTERIM).
 *
 * The endpoint RechargeDialog posts to when a founder runs out of credits.
 * Payments are NOT integrated yet (no Stripe SDK, keys, or webhook), so rather
 * than dead-ending the modal on a 501, this grants the requested pack's credits
 * for FREE — the founder's cap grows and they keep going (founder decision
 * 2026-06-16: ship working enforcement now, monetize when Stripe lands). With
 * free recharge in place, CREDITS_HARD_STOP can be enabled safely: nobody is
 * ever locked out with no way back.
 *
 * SECURITY: credits come from a SERVER-side PACKS map keyed by pack_id — the
 * client-sent `credits` field is ignored, so a tampered body can't mint an
 * arbitrary amount (bumpUserCredits also clamps per call).
 *
 * Request body: { pack_id: string }   (credits derived server-side)
 * Response:     { success:true, data: <CreditsSnapshot> }
 *
 * ── INTENDED LIVE FLOW (follow-up — when Stripe keys exist) ──────────────────
 *  Swap the free bump below for: validate pack_id → Stripe Checkout Session
 *  (mode:'payment', metadata {user_id, pack_id, credits}) → return
 *  { success:true, data:{ checkout_url } } (the dialog already redirects on
 *  that shape). A signature-verified webhook (STRIPE_WEBHOOK_SECRET) then calls
 *  bumpUserCredits on checkout.session.completed, idempotent on the Stripe event
 *  id (a payment_events table) so retried webhooks don't double-credit.
 *  Env needed: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, real pack pricing.
 */

/** Server-authoritative pack → credits map. The client picks an id; the amount
 *  is NEVER taken from the request body. Mirrors RechargeDialog's DEFAULT_PACKS. */
const PACKS: Record<string, number> = {
  pack_100: 100,
  pack_500: 500,
  pack_1000: 1000,
};

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    throw e;
  }

  let body: { pack_id?: unknown } = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    /* no/invalid body — fall through to the default pack */
  }

  // Resolve the grant from the server map; default to the smallest pack if the
  // id is unknown/absent. The client `credits` field is deliberately ignored.
  const packId = typeof body.pack_id === 'string' ? body.pack_id : '';
  const credits = PACKS[packId] ?? PACKS.pack_100;

  const snapshot = await bumpUserCredits(userId, credits);
  console.info(
    `[credits.recharge] free top-up — user=${userId} pack_id=${packId || '(default)'} ` +
      `+${credits} credits → ${snapshot.remaining}/${snapshot.total} remaining`,
  );

  return NextResponse.json({ success: true, data: snapshot });
}
