import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { EVENT_TO_TOPICS } from './query-events';

/**
 * Changelog 05/09 item 9 — "Spesso le chiamate mi danno errore e devo
 * refreshare la pagina per vederle attive."
 *
 * The cause was a rename that outran its map. On 2026-06-09 the founder-facing
 * watcher panel unified `monitors` + `watch_sources` and moved its query key
 * from ['monitors', …] to ['watchers', …]. This bridge kept flushing
 * 'monitors'. For three months every lp-actions-changed invalidated a prefix
 * only OnboardingCard still read, so the watcher list never refetched: apply a
 * watcher and it stayed absent until a manual reload — "vederle attive",
 * exactly.
 *
 * An invalidation that matches no query is silent: nothing throws, nothing
 * logs, the data is simply stale. So the map is pinned in BOTH directions.
 */

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}
const SOURCES = [...walk('src/app'), ...walk('src/components'), ...walk('src/hooks')];
const QUERY_KEYS = new Set(
  SOURCES.flatMap((f) =>
    [...readFileSync(join(ROOT, f), 'utf-8').matchAll(/queryKey:\s*\[\s*'([a-z-]+)'/g)].map((m) => m[1]),
  ),
);

describe('every topic the bridge flushes is a key some query actually uses', () => {
  it('no topic invalidates nothing', () => {
    const orphans = Object.entries(EVENT_TO_TOPICS).flatMap(([evt, topics]) =>
      topics.filter((t) => !QUERY_KEYS.has(t)).map((t) => `${evt} -> '${t}'`),
    );
    expect(orphans, `bridge topics no useQuery reads: ${orphans.join(', ')}`).toEqual([]);
  });

  it('the watcher list is reachable — the exact key item 9 turned on', () => {
    const onActions = EVENT_TO_TOPICS['lp-actions-changed'];
    expect(onActions).toContain('watchers');
    expect(onActions).toContain('watcher-detail');
  });

  it('and so is the spine, which is what flags a task complete', () => {
    expect(EVENT_TO_TOPICS['lp-actions-changed']).toContain('stages');
  });
});

describe('every event a component dispatches is actually received', () => {
  it('no lp-* event fires with neither a bridge entry nor a direct listener', () => {
    // Two legitimate ways to receive one: the bridge map, or an
    // addEventListener somewhere (lp-skills-changed, lp-persisted-artifacts and
    // lp-task-expanded drive imperative UI, not cache invalidation). Anything
    // with neither is a dispatch into nothing — lp-tasks-changed was exactly
    // that until 2026-09-10.
    const bodies = SOURCES.map((f) => readFileSync(join(ROOT, f), 'utf-8'));
    const dispatched = new Set(
      bodies.flatMap((s) => [...s.matchAll(/new (?:Custom)?Event\('(lp-[a-z-]+)'/g)].map((m) => m[1])),
    );
    const directlyHeard = new Set(
      bodies.flatMap((s) => [...s.matchAll(/addEventListener\('(lp-[a-z-]+)'/g)].map((m) => m[1])),
    );
    const unheard = [...dispatched].filter((e) => !(e in EVENT_TO_TOPICS) && !directlyHeard.has(e));
    expect(unheard, `events nothing receives: ${unheard.join(', ')}`).toEqual([]);
  });
});

describe('applying an action refreshes what the executor touched', () => {
  const page = readFileSync(join(ROOT, 'src/app/project/[projectId]/actions/page.tsx'), 'utf-8');

  it('the Inbox dispatches the event rather than invalidating its own list alone', () => {
    // An executor writes far outside the inbox: configure_monitor creates a
    // watcher, validation_proposal closes a spine check, signal_alert merges
    // into knowledge, run_skill spends credits. Invalidating ['actions'] alone
    // left every one of those stale until a reload.
    const fn = page.slice(page.indexOf('async function transition('), page.indexOf('const selected ='));
    expect(fn).toMatch(/dispatchEvent\(new CustomEvent\('lp-actions-changed'/);
  });

  it('and scopes it to this project, so another project is not flushed', () => {
    const fn = page.slice(page.indexOf('async function transition('), page.indexOf('const selected ='));
    expect(fn).toMatch(/'lp-actions-changed', \{ detail: \{ projectId \} \}/);
  });
});
