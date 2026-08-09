import { NextRequest, NextResponse } from 'next/server';
import { sendMagicLink } from '@/lib/email';
import { get } from '@/lib/db';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Supabase Auth Hook — Send Email.
 *
 * When configured in Supabase Dashboard → Auth → Hooks → Send Email,
 * Supabase POSTs here instead of sending its default email. This lets us
 * render the SenseFound-branded, locale-aware magic link template and
 * deliver via Resend.
 *
 * Payload shape (Supabase Auth Hook v1):
 * {
 *   user: { id, email, user_metadata: { locale?: string } },
 *   email_data: {
 *     token, token_hash, redirect_to,
 *     email_action_type: "magiclink" | "signup" | ...,
 *     site_url
 *   }
 * }
 *
 * Setup (ALL steps required — step 1 is enforced, the route 500s without it):
 *   1. Set SUPABASE_AUTH_HOOK_SECRET in the env (generate: openssl rand -hex 32)
 *   2. In Supabase Dashboard → Auth → Hooks → Send Email → Enable
 *   3. Set hook URL to: https://<your-domain>/api/auth/hook/send-email
 *   4. Set the HTTP hook secret to the same SUPABASE_AUTH_HOOK_SECRET value
 *
 * ⚠️ The 2026-08-08 onboarding audit found this route deployed, publicly
 * reachable and UNSIGNED (the secret was never set), i.e. an open relay that
 * would send a branded SenseFound email to any address with an attacker-chosen
 * link. It now fails CLOSED and never trusts the payload's own site_url.
 */

const HOOK_SECRET = process.env.SUPABASE_AUTH_HOOK_SECRET;
/** The link base is ours, never the caller's — see the open-relay note above. */
const APP_URL = process.env.SENSEFOUND_APP_URL || process.env.LAUNCHPAD_APP_URL || 'http://localhost:3000';

interface HookPayload {
  user: {
    id: string;
    email: string;
    user_metadata?: { locale?: string };
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
  };
}

/**
 * Email action types we render ourselves. Supabase's canonical token for a
 * magic link is 'magiclink' (NO underscore — see EmailOtpType in
 * @supabase/auth-js); the old 'magic_link' guard here matched nothing real.
 * 'signup' matters most: the login page calls signInWithOtp without
 * shouldCreateUser:false, so a brand-new founder's FIRST email is a signup,
 * not a magiclink — the one case that used to be rejected.
 *
 * A Send Email hook REPLACES Supabase's mailer: a non-2xx response fails the
 * auth request outright, it does NOT fall back to the default template. So
 * anything we don't render must still answer 200 (see below).
 */
const HANDLED_TYPES = new Set(['magiclink', 'signup', 'recovery', 'email_change', 'invite']);

function verifySignature(payload: string, signature: string | null): boolean {
  if (!HOOK_SECRET || !signature) return false;
  const expected = createHmac('sha256', HOOK_SECRET).update(payload).digest('hex');
  // Standard-Webhooks style headers carry "v1,<sig>" (possibly space-separated
  // for key rotation) — accept any listed signature that matches.
  const candidates = signature
    .split(/\s+/)
    .map((part) => (part.includes(',') ? part.slice(part.indexOf(',') + 1) : part));
  return candidates.some((candidate) => {
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
    } catch {
      return false; // length mismatch — not a match, not an error
    }
  });
}

export async function POST(request: NextRequest) {
  // Fail CLOSED. Without a secret we cannot tell Supabase apart from anyone
  // else on the internet, and this endpoint spends the live Resend key.
  if (!HOOK_SECRET) {
    console.error('[auth-hook/send-email] SUPABASE_AUTH_HOOK_SECRET is not set — refusing to send.');
    return NextResponse.json({ error: 'Hook not configured' }, { status: 500 });
  }

  const rawBody = await request.text();
  const sig =
    request.headers.get('webhook-signature') ?? request.headers.get('x-supabase-signature');
  if (!verifySignature(rawBody, sig)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: HookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { user, email_data } = body;
  const actionType = email_data.email_action_type;

  if (!HANDLED_TYPES.has(actionType)) {
    // 200, NOT 422: a non-2xx here aborts the founder's auth request. Answering
    // 200 without sending would silently swallow the email, so this is only for
    // types we deliberately do not use — logged so it is never silent.
    console.warn(`[auth-hook/send-email] Unhandled email type "${actionType}" — no email sent.`);
    return NextResponse.json({ success: true, skipped: actionType });
  }

  // Redemption: token_hash is verified by /api/auth/callback via verifyOtp.
  // `next` must be a RELATIVE path — redirect_to arrives absolute, and passing
  // it whole made the callback's open-redirect guard drop the deep link.
  let next = '/';
  try {
    const target = new URL(email_data.redirect_to || '/', APP_URL);
    next = `${target.pathname}${target.search}`;
    const inner = new URL(target.href).searchParams.get('next');
    if (inner && inner.startsWith('/') && !inner.startsWith('//')) next = inner;
  } catch {
    /* keep '/' */
  }

  const confirmationUrl =
    `${APP_URL}/api/auth/callback` +
    `?token_hash=${encodeURIComponent(email_data.token_hash)}` +
    `&type=${encodeURIComponent(actionType)}` +
    `&next=${encodeURIComponent(next)}`;

  // Locale: auth metadata is only ever written at account creation, so an
  // existing founder who later picked Italian in the app has an empty one.
  // The durable preference lives on users.locale — prefer it, fall back to
  // the metadata captured at signup.
  let locale = user.user_metadata?.locale;
  try {
    const row = await get<{ locale: string | null }>('SELECT locale FROM users WHERE id = ?', user.id);
    if (row?.locale) locale = row.locale;
  } catch {
    /* non-fatal: fall back to the metadata locale */
  }

  const result = await sendMagicLink(user.email, confirmationUrl, locale);

  if (!result.ok) {
    console.error('[auth-hook/send-email] Failed:', result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  if (result.stubbed) {
    // sendMagicLink reports ok:true when RESEND_API_KEY is absent (it only
    // logs). For the Monday Brief that is a harmless no-op; for the LOGIN
    // email it would strand the founder on "check your inbox" forever, so
    // surface it as a hook failure instead of claiming delivery.
    console.error('[auth-hook/send-email] RESEND_API_KEY missing — no login email was sent.');
    return NextResponse.json({ error: 'Mail transport not configured' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
