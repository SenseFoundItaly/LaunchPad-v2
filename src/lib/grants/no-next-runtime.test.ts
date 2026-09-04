import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';

/**
 * The grants sync must not drag the Next.js runtime behind it.
 *
 * It runs as a plain Netlify background function, outside the Next build. On
 * 2026-09-04 the deployed function died on EVERY invocation with
 * ERR_MODULE_NOT_FOUND for `next/server`, pulled in through a chain nothing
 * looked at: sync → ecosystem-monitors → api-helpers → next/server, all for
 * `generateId`. tsc, lint and 1,363 tests passed the whole time.
 *
 * A direct-import check would have missed it, so this walks the TRANSITIVE
 * graph — that is the only version of this test worth having.
 */

const ROOT = process.cwd();

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null; // bare package — handled by the caller
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Every first-party file reachable from `entry`, plus every bare package seen. */
function crawl(entry: string): { files: Set<string>; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^import\s+(?:type\s+)?[\s\S]*?from\s+'([^']+)'/gm)) {
      const spec = m[1];
      const isType = /^import\s+type\b/.test(m[0]);
      const resolved = resolveImport(spec, f);
      if (resolved) queue.push(resolved);
      else if (!spec.startsWith('.') && !spec.startsWith('@/') && !isType) {
        packages.set(spec, [...(packages.get(spec) ?? []), f.slice(ROOT.length + 1)]);
      }
    }
  }
  return { files, packages };
}

describe('the grants background function stays outside the Next runtime', () => {
  const entry = join(ROOT, 'src/lib/grants/sync.ts');
  const { files, packages } = crawl(entry);

  it('crawls a real graph', () => {
    expect(files.size).toBeGreaterThan(5);
  });

  it('imports nothing from next/* anywhere in its transitive graph', () => {
    const offenders = [...packages.entries()]
      .filter(([spec]) => spec === 'next' || spec.startsWith('next/'))
      .map(([spec, importers]) => `${spec} (via ${[...new Set(importers)].join(', ')})`);
    expect(offenders, `next runtime reachable from the grants sync: ${offenders.join(' | ')}`).toEqual([]);
  });

  it('the function entry point itself only reaches the sync', () => {
    const fn = readFileSync(join(ROOT, 'netlify/functions/grants-sync-background.mts'), 'utf8');
    expect(fn).toMatch(/from '\.\.\/\.\.\/src\/lib\/grants\/sync'/);
    expect(fn).not.toMatch(/from 'next/);
  });

  it('generateId lives in a module with no Next import', () => {
    const ids = readFileSync(join(ROOT, 'src/lib/ids.ts'), 'utf8');
    // Its own docstring explains the Next trap, so assert on IMPORTS, not prose.
    expect(ids).not.toMatch(/^import\b/m);
    // api-helpers keeps re-exporting it so the rest of the app is unaffected.
    expect(readFileSync(join(ROOT, 'src/lib/api-helpers.ts'), 'utf8')).toMatch(/export \{ generateId \} from '\.\/ids'/);
  });
});
