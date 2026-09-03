import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Heavy libraries must stay behind a dynamic boundary.
 *
 * Measured on a production build 2026-09-02, before this: recharts 398 KB in an
 * eagerly-grouped chunk, react-markdown 116 KB, and driver.js 44 KB — 14 KB of
 * it inside the ROOT LAYOUT chunk, so every visitor downloaded the onboarding
 * library on every page for a walkthrough that runs once per account.
 *
 * A single `import { X } from 'recharts'` anywhere on a route's eager path puts
 * the whole library back into that route's first load, silently. These tests
 * are the tripwire, because nothing else in the build output says so.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) acc.push(p);
  }
  return acc;
}
const FILES = walk(SRC);
const rel = (p: string) => p.slice(process.cwd().length + 1);

/** Static (top-of-file) imports of a module, ignoring `import type`. */
function staticImporters(spec: RegExp): string[] {
  return FILES.filter((f) => {
    const src = readFileSync(f, 'utf8');
    return src.split('\n').some((line) => {
      const m = line.match(/^import\s+(?!type\b)([\s\S]*?)from\s+'([^']+)'/);
      return !!m && spec.test(m[2]);
    });
  }).map(rel);
}

describe('heavy client libraries load on demand, not on every page', () => {
  it('recharts is never imported statically outside its own barrel', () => {
    // The barrel itself IS the lazy target — everything else must reach it
    // through next/dynamic.
    const allowed = new Set(['src/components/charts/index.tsx']);
    const offenders = staticImporters(/^recharts$/).filter((f) => !allowed.has(f));
    expect(offenders, `static recharts imports: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the charts barrel is only ever reached through next/dynamic', () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      if (rel(f).startsWith('src/components/charts/')) return false;
      return /^import\s+(?!type\b)[\s\S]*?from\s+'@\/components\/charts'/m.test(src);
    }).map(rel);
    expect(offenders, `static charts-barrel imports: ${offenders.join(', ')}`).toEqual([]);
  });

  it('react-markdown is not on the workspace dashboard eager path', () => {
    const offenders = staticImporters(/^react-markdown$/);
    expect(offenders, `static react-markdown imports: ${offenders.join(', ')}`).toEqual([]);
  });

  it('driver.js is loaded only when a tour run actually starts', () => {
    // A type-only import is fine and is what the controller keeps.
    const offenders = staticImporters(/^driver\.js/);
    expect(offenders, `static driver.js imports: ${offenders.join(', ')}`).toEqual([]);

    const ctrl = readFileSync(join(SRC, 'components/onboarding/TourController.tsx'), 'utf8');
    expect(ctrl).toMatch(/import type \{ Driver, DriveStep \} from 'driver\.js'/);
    expect(ctrl).toMatch(/import\('driver\.js'\)/);
    // Cached, or a chapter hand-off would re-import on every step boundary.
    expect(ctrl).toMatch(/if \(!driverModule\)/);
  });

  it('the root layout does not pull the tour library into every page', () => {
    const layout = readFileSync(join(SRC, 'app/layout.tsx'), 'utf8');
    expect(layout).toMatch(/TourControllerLazy/);
    expect(layout).not.toMatch(/from '@\/components\/onboarding\/TourController'/);
    const lazy = readFileSync(join(SRC, 'components/onboarding/TourControllerLazy.tsx'), 'utf8');
    expect(lazy).toMatch(/dynamic\(\(\) => import\('\.\/TourController'\), \{ ssr: false \}\)/);
  });
});

describe('in-app navigation never reloads the page', () => {
  it('no internal <a href> anywhere — those wipe the query cache', () => {
    // A full reload throws away the React tree AND the whole TanStack cache,
    // which is what "reloading, refetching every time" actually was on /demo.
    // Error boundaries and not-found are the ONE legitimate case: recovering
    // from a broken React tree is exactly when you want a real reload.
    const boundaries = /(^|\/)(error|not-found)\.tsx$/;
    const offenders = FILES.filter((f) => {
      if (boundaries.test(f)) return false;
      const src = readFileSync(f, 'utf8');
      return /<a\s+href=["'{]`?\//.test(src) && !/target="_blank"/.test(src);
    }).map(rel);
    expect(offenders, `internal <a href>: ${offenders.join(', ')}`).toEqual([]);
  });

  it('the demo links through next/link like the rest of the app', () => {
    for (const f of ['src/app/demo/sections.tsx', 'src/app/demo/chat/page.tsx']) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      expect(src, f).toMatch(/import Link from 'next\/link'/);
      expect(src, f).toMatch(/<Link href="\/demo/);
    }
  });
});

describe('the built bundle keeps them out of the first load', () => {
  const CHUNKS = join(process.cwd(), '.next/static/chunks');
  let files: string[] = [];
  try {
    files = walkJs(CHUNKS);
  } catch {
    /* no build in this working tree — the source-level tests above still hold */
  }

  function walkJs(dir: string, acc: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walkJs(p, acc);
      else if (p.endsWith('.js')) acc.push(p);
    }
    return acc;
  }

  it.skipIf(files.length === 0)('recharts, react-markdown and driver.js all sit in lazy chunks', () => {
    const signatures: Record<string, RegExp> = {
      recharts: /ResponsiveContainer|CartesianGrid/,
      'react-markdown': /mdast|remark-parse/,
      'driver.js': /driver-popover|popoverClass/,
    };
    for (const [lib, re] of Object.entries(signatures)) {
      const hits = files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => f.split('/').pop()!);
      expect(hits.length, `${lib} not found in the build`).toBeGreaterThan(0);
      // Next names an on-demand chunk `<id>.<hash>.js`; an eagerly grouped one
      // carries a dash (`<id>-<hash>.js`) or a route prefix like `app/layout-`.
      const eager = hits.filter((h) => !/^\d+\.[a-f0-9]+\.js$/.test(h));
      expect(eager, `${lib} still in eager chunk(s): ${eager.join(', ')}`).toEqual([]);
    }
  });

  it.skipIf(files.length === 0)('the total chunk count did not explode', () => {
    expect(files.length).toBeLessThan(220);
  });
});

// Keep statSync referenced for the size helpers above without widening scope.
void statSync;
