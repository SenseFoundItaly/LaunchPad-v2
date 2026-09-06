import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Each source syncs from where it is actually REACHABLE.
 *
 * incentivi.gov.it silently drops Netlify's traffic — proven on prod
 * 2026-09-06 across three attempts, ending at `connect ETIMEDOUT
 * 94.86.69.151:443 errno=-110`, a raw OS-level timeout that survived tripling
 * the connect budget to 30s. A REJECT would have surfaced as ECONNREFUSED. The
 * host is IPv4-only, so it is not an IPv6 stall, and the same egress reaches
 * SEDIA and Lombardia while an ordinary machine reaches incentivi in ~39s.
 *
 * So the split is forced, not stylistic, and putting incentivi back into the
 * background function would restore a silent daily failure.
 */
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

describe('the sources are split by reachability', () => {
  const bg = read('netlify/functions/grants-sync-background.mts');
  const runner = read('scripts/grants-sync-incentivi.mts');
  const wf = read('.github/workflows/scheduled-cron.yml');

  it('the background function syncs ONLY the sources Netlify can reach', () => {
    expect(bg).toMatch(/sources: \[sediaConnector, lombardiaConnector\]/);
    expect(bg).not.toMatch(/incentiviConnector/);
  });

  it('incentivi syncs from the runner, and only incentivi', () => {
    expect(runner).toMatch(/sources: \[incentiviConnector\]/);
    expect(runner).not.toMatch(/sediaConnector|lombardiaConnector/);
  });

  it('the runner step is actually wired into the daily workflow', () => {
    expect(wf).toMatch(/npx tsx scripts\/grants-sync-incentivi\.mts/);
    expect(wf).toMatch(/DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/);
    // It must run on a checkout with deps, or tsx has nothing to execute.
    expect(wf).toMatch(/actions\/checkout@v4/);
    expect(wf).toMatch(/npm ci/);
  });

  it('the runner fails LOUDLY — a silent failure is the thing being fixed', () => {
    expect(runner).toMatch(/DATABASE_URL is not set/);
    expect(runner).toMatch(/process\.exit\(1\)/);
    // Non-zero on a failed source, so the workflow step goes red.
    expect(runner).toMatch(/if \(!s\.ok\)[\s\S]{0,120}process\.exit\(1\)/);
  });

  it('every source still has exactly one home', () => {
    const inBg = ['sediaConnector', 'lombardiaConnector'].filter((c) => bg.includes(c));
    const inRunner = ['incentiviConnector'].filter((c) => runner.includes(c));
    expect([...inBg, ...inRunner].sort()).toEqual(
      ['incentiviConnector', 'lombardiaConnector', 'sediaConnector'],
    );
  });
});
