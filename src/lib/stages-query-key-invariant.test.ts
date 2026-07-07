import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the "Failed to load project" crash on the Co-pilot tab
 * (TypeError: s.find is not a function).
 *
 * ROOT CAUSE it protects against: two components (StageCard, ScorePanel) once
 * cached the raw payload OBJECT under the react-query key ['stages', projectId]
 * while useStages cached the sorted evaluations ARRAY under the SAME key.
 * react-query dedupes by key, so whichever mounted first won the cache and the
 * other read the wrong shape (`.find` on an object / `.evaluations` on an array).
 *
 * `tsc` CANNOT catch this — two `useQuery<T>` calls with different generics on
 * one key are both valid TypeScript. So we enforce the invariant structurally:
 * every ['stages', projectId] consumer must route through the single useStages
 * hook, which owns the one canonical shape. If you need this data elsewhere,
 * call useStages() — do NOT declare a competing query on the key.
 */

const SRC_DIR = fileURLToPath(new URL('../', import.meta.url)); // -> .../src/

// Dormant OpenClaw substrate + build output — mirrors vitest.config exclude.
// Never scanned (keeps the walk fast + focused on the web closure).
const SKIP_DIRS = new Set([
  'node_modules', '.next', 'dist',
  'agents', 'infra', 'gateway', 'commands', 'config', 'cli', 'cron',
  'plugins', 'auto-reply',
]);

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectSourceFiles(join(dir, entry.name), acc);
    } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      // Production source only — test/spec files legitimately reference the key
      // (in assertions and regexes like this one).
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

// An actual react-query key declaration `queryKey: ['stages', ...]` — not a
// prose mention of the key in a comment.
const STAGES_KEY = /queryKey:\s*\[\s*['"]stages['"]/;

describe("['stages', projectId] query-key invariant", () => {
  it('is owned by exactly one file — hooks/useStages.ts', () => {
    const owners = collectSourceFiles(SRC_DIR)
      .filter((f) => STAGES_KEY.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC_DIR, f).replace(/\\/g, '/'))
      .sort();

    expect(owners).toEqual(['hooks/useStages.ts']);
  });
});
