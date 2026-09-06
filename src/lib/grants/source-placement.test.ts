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

  it('incentivi is NOT synced from CI — a step there could only ever go red', () => {
    // Measured 2026-09-06: the runner (Azure) hit the same connect timeout as
    // Netlify (AWS). Re-adding a CI step would reinstate a guaranteed daily
    // failure, so the absence is the invariant.
    expect(wf).not.toMatch(/npx tsx scripts\/grants-sync-incentivi\.mts/);
    expect(wf).toMatch(/scripts\/launchd\/README\.md/);
  });

  it('the LaunchAgent path is complete: wrapper, installer, and the sync it calls', () => {
    const wrapper = read('scripts/grants-incentivi-daily.sh');
    expect(wrapper).toMatch(/grants-sync-incentivi\.mts/);
    // launchd hands over a minimal PATH; without this npx resolves nothing.
    expect(wrapper).toMatch(/export PATH=/);
    expect(wrapper).toMatch(/DATABASE_URL/);
    const installer = read('scripts/launchd/install-incentivi-agent.sh');
    expect(installer).toMatch(/StartCalendarInterval/);
    // launchd hands the job a bare PATH, so the plist must carry node's real
    // directory — resolved at install time. Guessing /usr/local/bin in the
    // wrapper failed on this machine (node is in ~/.local/bin) and the first
    // real launchd run died with "npx: command not found".
    expect(installer).toMatch(/NODE_DIR="\$\(dirname "\$NODE_BIN"\)"/);
    expect(installer).toMatch(/<key>EnvironmentVariables<\/key>/);
    expect(installer).toMatch(/<key>PATH<\/key><string>\$NODE_DIR:/);
    // Bootstrapping must not fire a sync as a side effect.
    expect(installer).toMatch(/<key>RunAtLoad<\/key><false\/>/);
    expect(installer).toMatch(/launchctl bootout/);
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
