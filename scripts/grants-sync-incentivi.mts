#!/usr/bin/env npx tsx
/**
 * Sync ONLY incentivi.gov.it, from wherever this is run.
 *
 * It exists because incentivi.gov.it silently drops Netlify's traffic. Proven
 * on prod 2026-09-06 across three attempts: the final error was
 * `connect ETIMEDOUT 94.86.69.151:443 errno=-110`, a raw OS-level TCP timeout
 * that survived tripling the connect budget to 30s. A REJECT would surface as
 * ECONNREFUSED; a silent DROP looks exactly like this. The host is IPv4-only,
 * so it is not an IPv6 stall, and SEDIA and Regione Lombardia reach fine from
 * the same egress while this one succeeds from an ordinary machine.
 *
 * So the daily split is by REACHABILITY, not preference:
 *   - SEDIA + Lombardia  → the Netlify background function;
 *   - incentivi          → here, on the GitHub Actions runner.
 *
 * Needs DATABASE_URL. Exits non-zero on failure so the workflow step goes red
 * rather than failing quietly — the whole point of this rewiring.
 */
import { syncFundingCalls } from '../src/lib/grants/sync';
import { incentiviConnector } from '../src/lib/grants/sources/incentivi';

if (!process.env.DATABASE_URL) {
  console.error('[grants][runner] DATABASE_URL is not set — refusing to run');
  process.exit(1);
}

const startedAt = Date.now();
const result = await syncFundingCalls({
  now: new Date(),
  sources: [incentiviConnector],
  force: process.argv.includes('--force'),
});

const s = result.sources[0];
if (!s) {
  console.error('[grants][runner] no source result returned');
  process.exit(1);
}
if (s.skipped_gate) {
  console.log('[grants][runner] incentivi already synced today — nothing to do');
  process.exit(0);
}
console.log(
  `[grants][runner] incentivi: ${s.ok ? 'ok' : 'FAILED'} fetched=${s.fetched} new=${s.inserted} `
    + `reopened=${s.reopened} closed=${s.closed_missing} alerts=${s.alerts_created}`
    + `${s.partial ? ' PARTIAL' : ''} in ${Date.now() - startedAt}ms`,
);
if (!s.ok) {
  console.error(`[grants][runner] ${s.error}`);
  process.exit(1);
}
process.exit(0);
