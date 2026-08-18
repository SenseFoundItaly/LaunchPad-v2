/**
 * The QA auth bypass, and the one place that decides whether it is live.
 *
 * `E2E_AUTH_ENABLED=1` makes an `x-e2e-user` header or cookie authenticate as
 * that user, with no password. It exists so API-driven and Playwright QA can
 * drive a real project without a magic-link round trip.
 *
 * Until now the only thing keeping it off a public site was a CONVENTION — four
 * files each said "never set in production" and each tested the flag alone.
 * A convention is not a guard, and on 2026-08-14 the staging site was found
 * serving it to the internet: `curl -H 'x-e2e-user: anything'` against
 * launchpad-staging returned 200 on an authenticated route. Prod was clean
 * (verified: 401 for both the header and the cookie form), so the exposure was
 * one env var on one site — which is exactly how a convention fails.
 *
 * So the flag is no longer sufficient. The bypass now ALSO requires that we are
 * not running on a deployed site.
 *
 * Detection uses Netlify's `CONTEXT`, the same signal telemetry.ts already uses
 * to tag environments. Netlify sets it on every deploy — `production`,
 * `deploy-preview`, `branch-deploy` — and to `dev` under `netlify dev`. So:
 *
 *   CONTEXT unset            → a local `next dev` / vitest run  → bypass allowed
 *   CONTEXT === 'dev'        → local `netlify dev`              → bypass allowed
 *   CONTEXT anything else    → a DEPLOYED site                  → bypass REFUSED
 *
 * Fail-closed on the axis that matters: an unrecognised CONTEXT value is
 * treated as deployed. A QA run that stops working is a nuisance; a public site
 * honouring a header as authentication is not.
 */

/** True when this process is serving a deployed site rather than a dev machine. */
export function isDeployedSite(): boolean {
  const ctx = (process.env.CONTEXT ?? '').trim().toLowerCase();
  if (!ctx) return false;        // no Netlify context → local
  return ctx !== 'dev';          // `netlify dev` is still local; everything else ships
}

/**
 * True when the `x-e2e-user` bypass may be honoured: explicitly enabled AND not
 * on a deployed site. Import this — never test `E2E_AUTH_ENABLED` directly, or
 * the guard grows a fifth copy that disagrees with the other four.
 */
export function e2eBypassEnabled(): boolean {
  return process.env.E2E_AUTH_ENABLED === '1' && !isDeployedSite();
}
