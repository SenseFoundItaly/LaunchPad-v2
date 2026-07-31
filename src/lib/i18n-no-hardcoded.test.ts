import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * i18n regression guard.
 *
 * The 2026-07 alpha rounds spent four PRs (#256–#258) removing ~230 hardcoded
 * founder-facing strings from Italian projects. This test stops them creeping
 * back: it scans client components for the two patterns the audit kept finding
 * — a bare string-literal `placeholder=` / `aria-label=` / `title=`, and a JSX
 * prose text node — and fails if any is NOT routed through `t(...)`.
 *
 * Deliberately conservative (both patterns are at ZERO on main, so no allowlist
 * is needed): it only flags high-signal cases. For a genuinely technical string
 * that must stay a literal, add `i18n-exempt` in a comment on the same line.
 */

// Founder-facing client surfaces. NOT src/app/api (server strings go through
// translate(), a separate concern) and NOT the /demo mock (static, by design).
const SCAN_ROOTS = ['src/components', 'src/app'];
const SKIP = (p: string) =>
  p.includes('/api/') ||
  p.includes('/demo/') ||
  p.endsWith('.test.ts') ||
  p.endsWith('.test.tsx') ||
  p.includes('/__tests__/');

// Per-file exemptions (path suffix). Empty by design — main is clean. Prefer an
// inline `i18n-exempt` comment over adding here.
const EXEMPT_FILES: string[] = [];

// Bare non-empty string-literal placeholder / aria-label / title. Expressions
// (`={t('…')}`, `={foo}`) and empty (`=""`) don't match — only literals do.
const ATTR_LITERAL = /\b(?:placeholder|aria-label|title)="[^"]*[A-Za-z]{2,}[^"]*"/;

// A JSX prose text node: ">Capitalized word word …<" with no braces/tags inside.
const JSX_PROSE = />[A-Z][a-zA-Z]+ [a-z]+ [a-z][^<>{}]*</;

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) walk(full, out);
    else if (full.endsWith('.tsx') && !SKIP(full)) out.push(full);
  }
}

describe('i18n regression guard — no hardcoded founder-facing strings', () => {
  it('every placeholder/aria-label/title + JSX prose node goes through t()', () => {
    const files: string[] = [];
    for (const root of SCAN_ROOTS) walk(root, files);
    expect(files.length).toBeGreaterThan(20); // sanity: we actually scanned

    const violations: string[] = [];
    for (const file of files) {
      if (EXEMPT_FILES.some((suffix) => file.endsWith(suffix))) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes('i18n-exempt')) return;
        if (ATTR_LITERAL.test(line)) {
          violations.push(`${file}:${i + 1}  hardcoded attribute → wrap in t()\n    ${line.trim().slice(0, 120)}`);
        } else if (JSX_PROSE.test(line)) {
          violations.push(`${file}:${i + 1}  hardcoded JSX text → wrap in t()\n    ${line.trim().slice(0, 120)}`);
        }
      });
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} hardcoded founder-facing string(s). Route them through t('key') ` +
        `(keys in src/lib/i18n/messages/{en,it}.ts), or add \`i18n-exempt\` on the line if it's genuinely technical:\n\n` +
        violations.join('\n\n'),
      );
    }
    expect(violations).toEqual([]);
  });
});
