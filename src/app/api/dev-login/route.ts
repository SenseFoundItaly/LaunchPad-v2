import { NextRequest, NextResponse } from 'next/server';

/**
 * DEV-ONLY login shim. Sets the `x-e2e-user` cookie that middleware.ts +
 * require-user.ts honor when `E2E_AUTH_ENABLED=1`, so local viewing on a
 * non-:3000 dev port (where Supabase magic-link redirect URLs aren't
 * configured) doesn't require email auth.
 *
 * Inert in production: returns 403 unless E2E_AUTH_ENABLED=1, which is never
 * set on the deployed site — so this can never mint a session in prod.
 *
 * Usage:  /api/dev-login?as=<userId>&to=/project/<projectId>
 *   - as  defaults to the local owner (hello@supalabs.co)
 *   - to  defaults to "/"
 */
export async function GET(request: NextRequest) {
  if (process.env.E2E_AUTH_ENABLED !== '1') {
    return NextResponse.json(
      { error: 'dev-login is disabled (set E2E_AUTH_ENABLED=1 to use it locally)' },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const as = url.searchParams.get('as') || 'cb05a0ea-720c-4795-b582-5b013e8f7572';
  // Only allow same-origin relative redirects — never an open redirect.
  const toParam = url.searchParams.get('to') || '/';
  const to = toParam.startsWith('/') ? toParam : '/';

  const res = NextResponse.redirect(new URL(to, url.origin));
  res.cookies.set('x-e2e-user', as, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
