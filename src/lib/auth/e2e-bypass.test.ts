import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { e2eBypassEnabled, isDeployedSite } from './e2e-bypass';

/**
 * The QA auth bypass turns an `x-e2e-user` header into an authenticated
 * session with no password. Until 2026-08-14 the only thing keeping it off a
 * public site was a CONVENTION — four files each tested the flag alone and each
 * carried a comment saying it is "never set in production".
 *
 * It was set on staging. `curl -H 'x-e2e-user: anything'` against
 * launchpad-staging returned 200 on an authenticated route; prod was clean
 * (401 for both header and cookie). One env var on one site, which is exactly
 * how a convention fails.
 *
 * The flag is now necessary but not sufficient.
 */
const ENV = { ...process.env };
beforeEach(() => { delete process.env.CONTEXT; delete process.env.E2E_AUTH_ENABLED; });
afterEach(() => { process.env = { ...ENV }; });

describe('isDeployedSite', () => {
  it('no CONTEXT = a local next dev / vitest run', () => {
    expect(isDeployedSite()).toBe(false);
  });

  it("CONTEXT=dev is `netlify dev` — still local", () => {
    process.env.CONTEXT = 'dev';
    expect(isDeployedSite()).toBe(false);
  });

  it.each(['production', 'deploy-preview', 'branch-deploy'])('CONTEXT=%s is deployed', (ctx) => {
    process.env.CONTEXT = ctx;
    expect(isDeployedSite()).toBe(true);
  });

  it('an UNRECOGNISED context counts as deployed — fail closed', () => {
    // A QA run that stops working is a nuisance. A public site honouring a
    // header as authentication is not.
    process.env.CONTEXT = 'something-netlify-adds-in-2027';
    expect(isDeployedSite()).toBe(true);
  });
});

describe('e2eBypassEnabled', () => {
  it('needs the flag — absent means off, deployed or not', () => {
    expect(e2eBypassEnabled()).toBe(false);
    process.env.CONTEXT = 'dev';
    expect(e2eBypassEnabled()).toBe(false);
  });

  it('flag + local = the bypass QA relies on', () => {
    process.env.E2E_AUTH_ENABLED = '1';
    expect(e2eBypassEnabled()).toBe(true);
  });

  it('REGRESSION: flag + deployed = REFUSED, whatever the env says', () => {
    // This is the staging case exactly: the flag was set on a live site.
    process.env.E2E_AUTH_ENABLED = '1';
    for (const ctx of ['production', 'deploy-preview', 'branch-deploy']) {
      process.env.CONTEXT = ctx;
      expect(e2eBypassEnabled(), ctx).toBe(false);
    }
  });
});

describe('every bypass site goes through the one guard', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
  const SITES = [
    'src/lib/auth/require-user.ts',
    'src/middleware.ts',
    'src/app/api/dev-login/route.ts',
    'src/app/api/dev-projects/route.ts',
  ];

  it.each(SITES)('%s calls e2eBypassEnabled()', (f) => {
    expect(read(f)).toContain('e2eBypassEnabled()');
  });

  it.each(SITES)('%s no longer branches on the raw flag', (f) => {
    // A fifth copy of the condition is how the first four drifted apart.
    const code = read(f).split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
    expect(code.join('\n')).not.toMatch(/if\s*\(\s*!?process\.env\.E2E_AUTH_ENABLED/);
  });
});
