import { NextRequest, NextResponse } from 'next/server';
import { sendMagicLink } from '@/lib/email';
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
 *     email_action_type: "magic_link" | "signup" | ...,
 *     site_url
 *   }
 * }
 *
 * Setup:
 *   1. Set SUPABASE_AUTH_HOOK_SECRET in .env (generate: openssl rand -hex 32)
 *   2. In Supabase Dashboard → Auth → Hooks → Send Email → Enable
 *   3. Set hook URL to: https://<your-domain>/api/auth/hook/send-email
 *   4. Set HTTP hook secret to the same SUPABASE_AUTH_HOOK_SECRET value
 */

const HOOK_SECRET = process.env.SUPABASE_AUTH_HOOK_SECRET;

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

function verifySignature(payload: string, signature: string | null): boolean {
  if (!HOOK_SECRET || !signature) return false;
  const expected = createHmac('sha256', HOOK_SECRET).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Verify HMAC signature when secret is configured
  if (HOOK_SECRET) {
    const sig = request.headers.get('x-supabase-signature');
    if (!verifySignature(rawBody, sig)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  let body: HookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { user, email_data } = body;

  // Only handle magic_link emails; let Supabase handle others as default
  if (email_data.email_action_type !== 'magic_link') {
    return NextResponse.json({ error: 'Unhandled email type' }, { status: 422 });
  }

  // Build the confirmation URL with the token hash
  const confirmationUrl = `${email_data.site_url}/api/auth/callback?token_hash=${email_data.token_hash}&type=magiclink&next=${encodeURIComponent(email_data.redirect_to || '/')}`;

  const locale = user.user_metadata?.locale;
  const result = await sendMagicLink(user.email, confirmationUrl, locale);

  if (!result.ok) {
    console.error('[auth-hook/send-email] Failed:', result.error);
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
