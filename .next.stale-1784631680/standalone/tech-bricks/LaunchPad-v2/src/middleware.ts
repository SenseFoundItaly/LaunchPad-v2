import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Auth middleware: runs on every request (except static assets).
 *
 *   - Refreshes the Supabase session cookie when close to expiry.
 *   - Redirects unauthenticated page requests to /login?next=...
 *   - Lets unauthenticated API requests through so routes can return a
 *     structured 401 JSON instead of an HTML redirect.
 *   - Allow-lists a few paths: /login, /api/auth/*, /api/health,
 *     /published/*, and Next.js internals.
 */

// '/demo' is the static vision-demo page (src/app/demo) — no data, safe public.
const PUBLIC_PREFIXES = ['/login', '/api/auth', '/api/health', '/published', '/demo'];
const PUBLIC_EXACT = new Set(['/favicon.ico']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// DELETE is deliberately absent: bodyless DELETEs carry no Content-Type
// (axios strips the default header when there's no data; fetch never sets
// one), so requiring it 415s legitimate deletes — while HTML forms can't
// emit DELETE at all, so the rule added no CSRF protection there.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);

export async function middleware(req: NextRequest) {
  // E2E bypass: same flag as require-user.ts. When set, an x-e2e-user cookie
  // (or header) means the request is authenticated — skip redirect-to-login.
  if (process.env.E2E_AUTH_ENABLED === '1') {
    const e2eId = req.headers.get('x-e2e-user') || req.cookies.get('x-e2e-user')?.value;
    if (e2eId) return NextResponse.next({ request: req });
  }

  // CSRF mitigation: reject mutating API requests without JSON Content-Type.
  // Browsers cannot set Content-Type: application/json from plain form
  // submissions, so this blocks cross-origin form-based CSRF attacks.
  // Exemptions:
  //   - /api/auth/*  — session management uses cookies, not JSON bodies.
  //   - file uploads — multipart/form-data is REQUIRED to send a file, so the
  //     JSON-only rule would 415 every legitimate upload. Scope the exemption
  //     to dedicated upload endpoints (path ends in /upload) and to multipart
  //     specifically; those routes are auth-gated, and the residual CSRF risk
  //     (an attacker tricking a logged-in user into uploading to their OWN
  //     knowledge base) is minimal. Every other mutating route still needs JSON.
  const contentType = req.headers.get('content-type') || '';
  const isMultipartUpload =
    contentType.includes('multipart/form-data') && req.nextUrl.pathname.endsWith('/upload');
  if (
    MUTATING_METHODS.has(req.method) &&
    req.nextUrl.pathname.startsWith('/api/') &&
    !req.nextUrl.pathname.startsWith('/api/auth/') &&
    !contentType.includes('application/json') &&
    !isMultipartUpload
  ) {
    return new NextResponse(
      JSON.stringify({ error: 'Content-Type must be application/json' }),
      { status: 415, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let response = NextResponse.next({ request: req });

  // Only bootstrap Supabase if the env vars are set. If they're missing
  // (e.g. local dev without Supabase configured), skip auth entirely so
  // the app still boots — the user will see pages but API routes that
  // call requireUser() will 401.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return response;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet) {
        for (const { name, value } of toSet) {
          req.cookies.set(name, value);
        }
        response = NextResponse.next({ request: req });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touching getUser() refreshes the session cookie if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = req.nextUrl;

  if (user) return response;
  if (isPublicPath(pathname)) return response;

  // Unauthenticated API requests: let the route decide (it'll 401 via requireUser).
  if (pathname.startsWith('/api/')) return response;

  // Unauthenticated page requests: redirect to login.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Run on every route except Next.js static and image assets.
  matcher: ['/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
