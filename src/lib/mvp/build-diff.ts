// ============================================================================
// Version-over-version change list (#349).
//
// Drivers like v0 return no diff, so "what changed in v2?" was unanswerable and
// the Changes block in the UI stayed empty. We store a name→hash fingerprint per
// version (contents would bloat the row) and diff consecutive snapshots here.
// Pure + unit-tested; the runner just persists the result.
// ============================================================================

import type { BuildFileChange } from '@/lib/builders/types';

export function diffFileHashes(
  prev: Record<string, string> | null | undefined,
  next: Record<string, string> | null | undefined,
): BuildFileChange[] {
  if (!next) return [];
  // No previous snapshot (first build, or a driver that didn't report one):
  // everything is "added" would be noise on a create, so report nothing.
  if (!prev) return [];

  const out: BuildFileChange[] = [];
  for (const [path, hash] of Object.entries(next)) {
    if (!(path in prev)) out.push({ path, change: 'added' });
    else if (prev[path] !== hash) out.push({ path, change: 'modified' });
  }
  for (const path of Object.keys(prev)) {
    if (!(path in next)) out.push({ path, change: 'deleted' });
  }
  // Stable, reviewable order: modified first (the interesting ones), then
  // added, then deleted; alphabetical within each group.
  const rank = { modified: 0, added: 1, deleted: 2 } as const;
  return out.sort((a, b) => rank[a.change] - rank[b.change] || a.path.localeCompare(b.path));
}
