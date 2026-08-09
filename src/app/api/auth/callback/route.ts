import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { getSupabaseServer } from '@/lib/auth/supabase-server';
import { requireUser } from '@/lib/auth/require-user';
import { get, run } from '@/lib/db';
import { sendWelcomeEmail } from '@/lib/email';

/**
 * Supabase OAuth / magic-link redirect target. Handles BOTH link shapes:
 *
 *   GET /api/auth/callback?code=...&next=/dashboard              (PKCE — Supabase's own template)
 *   GET /api/auth/callback?token_hash=...&type=magiclink&next=/  (our branded auth-hook email)
 *
 * Exchanges the credential for a session cookie, then bootstraps our shadow
 * user + personal org via requireUser(), then redirects.
 *
 * ⚠️ The token_hash branch is not optional polish: the branded email built by
 * /api/auth/hook/send-email mints exactly that shape, and until the 2026-08-08
 * audit this route only read `code` — so enabling the hook would have bounced
 * every founder to /login with no session and no explanation.
 *
 * We deliberately catch errors from requireUser() and redirect the user
 * to /login?error=... rather than returning 500 — the session is set
 * regardless, so they can retry without re-requesting a magic link.
 */

/** Supabase's verifiable email OTP types (EmailOtpType), guarded at the edge. */
const OTP_TYPES = new Set<string>(['magiclink', 'signup', 'recovery', 'email_change', 'invite', 'email']);

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  const rawNext = url.searchParams.get('next') || '/';
  // Prevent open redirect: only allow relative paths starting with /
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const supabase = await getSupabaseServer();

  let authError: string | null = null;
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    authError = error?.message ?? null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    authError = error?.message ?? null;
  } else {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  if (authError) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(authError)}`, url.origin),
    );
  }

  // Create shadow user + personal org on first login. If this fails we still
  // send the user on — the next authed request will retry the upsert.
  let locale: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    const authUser = data?.user;
    // Read BEFORE requireUser(), which is what creates the row — this is how
    // we know a first-ever login from a returning one without a new column.
    const preexisting = authUser
      ? await get<{ id: string }>('SELECT id FROM users WHERE id = ?', authUser.id)
      : null;

    await requireUser();

    // The founder's language was captured at sign-in (navigator.language →
    // user_metadata) and used to pick the email language, then historically
    // dropped: users.locale stayed NULL and their FIRST project got frozen at
    // 'en' (project.locale drives all in-project UI and cannot be changed
    // after creation). Persist it here, once, without overwriting a choice the
    // founder later made in Settings.
    const metaLocale = (authUser?.user_metadata as { locale?: string } | undefined)?.locale;
    if (authUser && (metaLocale === 'it' || metaLocale === 'en')) {
      locale = metaLocale;
      await run('UPDATE users SET locale = ? WHERE id = ? AND locale IS NULL', metaLocale, authUser.id);
    }

    // First login ever → the welcome email. Awaited on purpose: a serverless
    // function freezes un-awaited work, and this is the founder's only
    // introduction to the product (and the only warning that a weekly email
    // exists). Non-fatal — a mail failure must never block getting in.
    if (authUser?.email && !preexisting) {
      const result = await sendWelcomeEmail(authUser.email, locale ?? undefined);
      if (!result.ok) console.warn('[auth/callback] welcome email failed:', result.error);
    }
  } catch {
    // Swallowed intentionally; see doc above.
  }

  const response = NextResponse.redirect(new URL(next, url.origin));
  if (locale) {
    // Seed the UI locale for this first session so the app the founder lands
    // in speaks the language their login email did.
    response.cookies.set('lp_locale', locale, {
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
    });
  }
  return response;
}
