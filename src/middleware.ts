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

const PUBLIC_PREFIXES = ['/login', '/api/auth', '/api/health', '/published'];
const PUBLIC_EXACT = new Set(['/favicon.ico']);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export async function middleware(req: NextRequest) {
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
