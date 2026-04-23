import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/auth/supabase-server';
import { requireUser } from '@/lib/auth/require-user';

/**
 * Supabase OAuth / magic-link redirect target.
 *
 *   GET /api/auth/callback?code=...&next=/dashboard
 *
 * Exchanges the short-lived code for a session cookie, then bootstraps
 * our shadow user + personal org via requireUser(), then redirects.
 *
 * We deliberately catch errors from requireUser() and redirect the user
 * to /login?error=... rather than returning 500 — the session is set
 * regardless, so they can retry without re-requesting a magic link.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/';

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', url.origin));
  }

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin),
    );
  }

  // Create shadow user + personal org on first login. If this fails we still
  // send the user on — the next authed request will retry the upsert.
  try {
    await requireUser();
  } catch {
    // Swallowed intentionally; see doc above.
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
