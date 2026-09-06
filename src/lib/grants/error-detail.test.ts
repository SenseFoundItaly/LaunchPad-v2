import { describe, it, expect } from 'vitest';
import { describeError } from './error-detail';

/**
 * Node's fetch reports every transport failure as "fetch failed" and puts the
 * real reason on `cause`. Recording only `.message` cost a debugging round on
 * 2026-09-04: incentivi.gov.it failed from Netlify while working from a laptop
 * and last_error could only say "fetch failed" — which distinguishes DNS from
 * TLS from a refused connection not at all.
 */
describe('describeError', () => {
  it('unwraps the undici cause that "fetch failed" hides', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND www.incentivi.gov.it'), {
      code: 'ENOTFOUND', syscall: 'getaddrinfo', hostname: 'www.incentivi.gov.it',
    });
    const out = describeError(Object.assign(new TypeError('fetch failed'), { cause }));
    expect(out).toContain('fetch failed');
    expect(out).toContain('ENOTFOUND');
    expect(out).toContain('www.incentivi.gov.it');
  });

  it('reads an AggregateError, which carries failures on .errors not .cause', () => {
    const agg = Object.assign(new AggregateError([
      Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' }),
    ], 'all attempts failed'), {});
    expect(describeError(Object.assign(new TypeError('fetch failed'), { cause: agg })))
      .toContain('ECONNREFUSED');
  });

  it('does not loop on a self-referential cause', () => {
    const e = new Error('boom') as Error & { cause?: unknown };
    e.cause = e;
    expect(describeError(e)).toBe('boom');
  });

  it('stays short enough for last_error and the freshness row', () => {
    const long = new Error('x'.repeat(2000));
    expect(describeError(long).length).toBeLessThanOrEqual(500);
  });

  it('survives a non-Error throw', () => {
    expect(describeError('just a string')).toContain('just a string');
    expect(describeError(null)).toBeTruthy();
  });

  it('does not repeat the same message at every level', () => {
    const inner = new Error('same');
    const out = describeError(Object.assign(new Error('same'), { cause: inner }));
    expect(out.match(/same/g)?.length).toBe(1);
  });
});
