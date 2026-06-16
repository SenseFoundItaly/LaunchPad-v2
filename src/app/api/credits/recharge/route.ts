import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/require-user';

/**
 * POST /api/credits/recharge — STUB (payments not yet integrated).
 *
 * This is the server endpoint the RechargeDialog posts to when a founder runs
 * out of credits. There is NO payment backend wired yet (no Stripe SDK, no
 * keys, no webhook), so this deliberately returns 501 + a structured
 * `payments_not_integrated` error rather than pretending to charge or topping
 * up the pool for free. The client shows a "coming soon" state on this body.
 *
 * Request body (already the shape the dialog sends, so the contract is stable
 * once payments land):
 *   { pack_id: string, credits: number }
 *
 * ── INTENDED LIVE FLOW (follow-up — do NOT implement here without keys) ──────
 *  1. Validate `pack_id` against a server-side PACKS table (id → credits + price
 *     in cents). NEVER trust a client-sent price; derive it from pack_id so the
 *     amount charged can't be tampered with.
 *  2. Create a Stripe Checkout Session (mode: 'payment') for that pack, with
 *     metadata { user_id, pack_id, credits } and client_reference_id = user_id.
 *     Return { success:true, data:{ checkout_url } }; the dialog redirects there.
 *  3. Webhook `POST /api/credits/webhook` verifies the Stripe signature
 *     (STRIPE_WEBHOOK_SECRET) and, on `checkout.session.completed`, tops up the
 *     user's CURRENT-month user_budgets row — either:
 *       (a) add `credits` to cap_credits (and bump cap_llm_usd proportionally so
 *           creditsPerDollar stays constant), the same math as the dev `bump`
 *           PATCH in /api/projects/[projectId]/credits, OR
 *       (b) reset current_llm_usd toward 0 to refill the existing pool.
 *     (a) is preferred — it's additive and auditable. Make the webhook
 *     idempotent on the Stripe event id (a payment_events table) so retried
 *     webhooks don't double-credit.
 *  4. Only THEN flip CREDITS_HARD_STOP on (and set CREDITS_EXEMPT_USER_IDS to
 *     grace the founder/admins) so the lockout has a real way out.
 *
 * Env needed when going live (none referenced here yet): STRIPE_SECRET_KEY,
 * STRIPE_WEBHOOK_SECRET, and a price/pack mapping.
 */
export async function POST(request: NextRequest) {
  // Auth so the endpoint is real (and so the future flow already has the user).
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ success: false, error: e.message }, { status: e.status });
    }
    throw e;
  }

  // Parse defensively — the body shape is informational until payments exist.
  let pack: { pack_id?: unknown; credits?: unknown } = {};
  try {
    pack = (await request.json()) ?? {};
  } catch {
    /* no/invalid body — the stub doesn't need it, fall through to 501 */
  }

  console.info(
    `[credits.recharge] stub hit — user=${userId} pack_id=${String(pack.pack_id ?? '?')} ` +
      `credits=${String(pack.credits ?? '?')} (payments not integrated)`,
  );

  // 501 Not Implemented — the dialog reads `error: 'payments_not_integrated'`
  // to render the "coming soon" message instead of a generic failure.
  return NextResponse.json(
    {
      success: false,
      error: 'payments_not_integrated',
      message: 'Recharge is not available yet — payments are not integrated.',
    },
    { status: 501 },
  );
}
