import { syncFundingCalls } from '../../src/lib/grants/sync';

/**
 * Daily grants sync — a Netlify BACKGROUND function.
 *
 * Why this exists at all: a full three-source sync (SEDIA + Regione Lombardia +
 * incentivi.gov.it) takes 75-81s, and per-source it is 28.5s / 15.6s / 42.3s,
 * so it does not fit under Netlify's ~26s synchronous limit whole OR one source
 * at a time. Two earlier attempts are worth not repeating:
 *
 *   - running it inline in /api/cron: killed mid-sync every day, so
 *     funding_source_state.last_success_at never advanced;
 *   - streaming it from /api/cron/grants: the repo believed a consumed stream
 *     extends a Netlify function. It does not — measured on prod 2026-09-02,
 *     the stream emitted heartbeats to 30s and then died with no done frame.
 *
 * The `-background` suffix is the whole mechanism: Netlify answers the caller
 * 202 immediately and lets this run up to 15 minutes. Nothing can read a return
 * value, so the run reports itself two ways — `[grants]` lines in the function
 * log, and funding_source_state, which the founder-facing freshness rows on the
 * grants page already render.
 *
 * Bundling note: this file lives outside the Next build, but netlify.toml
 * deliberately has NO [functions] section (it would override the adapter's
 * bundling), so imports rely on the bundler honouring tsconfig `@/*` paths —
 * verified by bundling this graph before writing it.
 */

export default async (req: Request): Promise<Response> => {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[grants][bg] CRON_SECRET is not set — refusing to run');
    return new Response('not configured', { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    // Publicly addressable, so this gate is the only thing standing between the
    // sources and anyone who can guess the path.
    return new Response('unauthorized', { status: 401 });
  }

  const startedAt = Date.now();
  console.log('[grants][bg] sync starting');
  try {
    const result = await syncFundingCalls({ now: new Date() });
    const ran = result.sources.filter((s) => !s.skipped_gate);
    for (const s of ran) {
      console.log(
        `[grants][bg] ${s.source}: ${s.ok ? 'ok' : `FAILED(${s.error})`} `
          + `fetched=${s.fetched} new=${s.inserted} reopened=${s.reopened} `
          + `closed=${s.closed_missing} alerts=${s.alerts_created}${s.partial ? ' PARTIAL' : ''}`,
      );
    }
    console.log(
      `[grants][bg] done in ${Date.now() - startedAt}ms — `
        + `${ran.length} source(s) ran, ${result.expired} expired, `
        + `${result.alerts_dismissed} alert(s) auto-dismissed${result.error ? `, error: ${result.error}` : ''}`,
    );
  } catch (err) {
    // A throw here is invisible to the caller (it already got its 202), so the
    // log line IS the alarm. last_success_at stays put, which is what makes the
    // page's freshness row go stale and show the failure to the founder.
    console.error(`[grants][bg] sync threw after ${Date.now() - startedAt}ms:`, err);
  }
  return new Response(null, { status: 204 });
};
