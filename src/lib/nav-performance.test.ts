import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Navigation performance invariants.
 *
 * Two measured problems, pinned so they cannot quietly come back:
 *
 *   1. No route had a `loading.tsx`. In the App Router that boundary is what
 *      makes prefetch worth anything on a dynamic route — without one, a click
 *      leaves the previous page on screen for the whole server round-trip
 *      (measured on prod 2026-09-02: ~200ms per navigation, before the client
 *      bundle even starts).
 *   2. The auth middleware ran `supabase.auth.getUser()` — a network call — and
 *      only THEN checked whether the path was public, so /demo, /login and
 *      /api/health each paid for an auth round-trip they discarded. Measured:
 *      30ms for a route the matcher skips vs 218ms for one it runs.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

/** Every app route segment that ships a page, excluding the static demo tree. */
function routeSegmentsWithPages(dir = 'src/app', acc: string[] = []): string[] {
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'api' || entry.name === 'demo') continue;
    const child = `${dir}/${entry.name}`;
    if (existsSync(join(process.cwd(), child, 'page.tsx'))) acc.push(child);
    routeSegmentsWithPages(child, acc);
  }
  return acc;
}

describe('every route can paint something immediately', () => {
  const segments = ['src/app', ...routeSegmentsWithPages()].filter((s) =>
    existsSync(join(process.cwd(), s, 'page.tsx')),
  );

  it('finds the real route segments', () => {
    expect(segments.length).toBeGreaterThan(10);
    expect(segments).toContain('src/app/project/[projectId]/chat');
  });

  it('every navigable segment has a loading boundary', () => {
    // /login and /onboard are entry points reached by full page load, not by an
    // in-app <Link>, so a shell there buys nothing.
    // project/[projectId] is a server redirect to /today — it renders nothing,
    // so a shell there would flash and then be replaced by the real segment's.
    const exempt = new Set(['src/app/login', 'src/app/design/ui', 'src/app/project/[projectId]']);
    const missing = segments.filter(
      (s) => !exempt.has(s) && !s.startsWith('src/app/onboard') && !existsSync(join(process.cwd(), s, 'loading.tsx')),
    );
    expect(missing, `segments without loading.tsx: ${missing.join(', ')}`).toEqual([]);
  });

  it('loading shells stay server components — no client runtime, no locale hook', () => {
    for (const s of segments) {
      const p = join(s, 'loading.tsx');
      if (!existsSync(join(process.cwd(), p))) continue;
      const src = read(p);
      expect(src, p).not.toMatch(/'use client'/);
      expect(src, p).not.toMatch(/useT\(|useState|useEffect|useQuery/);
      expect(src, p).toMatch(/RouteSkeleton/);
    }
  });

  it('the skeleton itself is a server component and carries no copy to translate', () => {
    const src = read('src/components/ui/RouteSkeleton.tsx');
    expect(src).not.toMatch(/'use client'/);
    expect(src).not.toMatch(/useT\(|useLocale\(/);
    // Shapes only: no user-visible text means nothing to localise and nothing
    // to go stale. role=status + aria-busy carries the meaning instead.
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/aria-busy="true"/);
  });

  it('the shell respects reduced motion', () => {
    const css = read('src/app/globals.css');
    expect(css).toMatch(/lp-skeleton/);
    expect(css).toMatch(/prefers-reduced-motion[\s\S]{0,200}lp-skeleton/);
  });
});

describe('the auth middleware does not pay for auth it discards', () => {
  const mw = read('src/middleware.ts');

  it('public paths return before the Supabase round-trip', () => {
    const publicCheck = mw.indexOf('if (isPublicPath(pathname)) {');
    const getUser = mw.indexOf('await supabase.auth.getUser()');
    expect(publicCheck).toBeGreaterThan(-1);
    expect(getUser).toBeGreaterThan(-1);
    expect(publicCheck, 'the public-path check must come FIRST').toBeLessThan(getUser);
  });

  it('the CSRF gate still runs before anything returns early', () => {
    // A public-path early return placed above the Content-Type check would
    // reopen form-based CSRF on /api/auth.
    const csrf = mw.indexOf('Content-Type must be application/json');
    const publicCheck = mw.indexOf('if (isPublicPath(pathname)) {');
    expect(csrf).toBeGreaterThan(-1);
    expect(csrf, 'CSRF check must precede the public early return').toBeLessThan(publicCheck);
  });

  it('protected pages still redirect unauthenticated visitors to login', () => {
    expect(mw).toMatch(/NextResponse\.redirect\(loginUrl\)/);
    expect(mw).toMatch(/loginUrl\.searchParams\.set\('next', pathname\)/);
    // And the user check still gates it.
    expect(mw).toMatch(/if \(user\) return response;/);
  });

  it('unauthenticated API requests still reach the route for a JSON 401', () => {
    expect(mw).toMatch(/if \(pathname\.startsWith\('\/api\/'\)\) return response;/);
  });

  it('the demo and the unfurl images remain public', () => {
    expect(mw).toMatch(/'\/demo'/);
    expect(mw).toMatch(/'\/opengraph-image'/);
  });
});
