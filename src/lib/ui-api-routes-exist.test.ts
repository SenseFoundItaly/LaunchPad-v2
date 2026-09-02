/**
 * Every `/api/...` path the UI references must have a route file on disk.
 *
 * Field report (2026-09-02): the unwired-sweep cleanup (acaa8fe6) deleted
 * src/app/api/dashboard/route.ts as "zero callers" — it grepped for
 * `fetch('/api/...')` and missed `api.get('/api/dashboard')` in
 * src/app/page.tsx. Prod's home page showed "No projects yet" to every
 * founder for a day. This test makes that class of deletion fail CI.
 *
 * Matching: a `${...}` segment in the reference matches any `[param]`
 * directory; middleware prefix matchers (`/api/`, `/api/auth`) and literal
 * ellipses are skipped.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const ROOT = process.cwd();
const API_DIR = join(ROOT, 'src/app/api');

const routes = walk(API_DIR)
  .filter((f) => /[\\/]route\.ts$/.test(f))
  .map((f) => dirname(f).slice(API_DIR.length).split(/[\\/]/).filter(Boolean));

function routeExists(segs: string[]): boolean {
  return routes.some(
    (r) => r.length === segs.length && r.every((seg, i) => seg.startsWith('[') || seg === segs[i] || segs[i] === '*'),
  );
}

const SKIP = new Set(['/api', '/api/', '/api/auth', '/api/auth/']);

describe('UI-referenced /api paths have a route file', () => {
  it('finds a route for every literal /api/... the UI calls', () => {
    const uiFiles = walk(join(ROOT, 'src')).filter(
      (f) => !f.startsWith(API_DIR) && !/\.test\.tsx?$/.test(f),
    );
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const f of uiFiles) {
      const src = readFileSync(f, 'utf8');
      const re = /[`'"](\/api\/[^`'"\s]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        let p = m[1].split('?')[0].replace(/\$\{[^}]*\}/g, '*').replace(/\/\*[^/]*/g, '/*');
        if (p.includes('…') || p.includes('+') || SKIP.has(p) || p.endsWith('/')) continue;
        const key = `${p} <- ${f.slice(ROOT.length + 1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const segs = p.replace(/^\/api\/?/, '').split('/').filter(Boolean);
        if (segs.length === 0) continue;
        if (!routeExists(segs)) missing.push(key);
      }
    }
    expect(missing, `UI calls these API paths but no route file exists:\n${missing.join('\n')}`).toEqual([]);
  });
});
