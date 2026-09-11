import { describe, it, expect } from 'vitest';
import { canonicalizeDdgHref } from '@/lib/pi-tools';

// Gap 7: DDG HTML endpoint returns provider-redirect hrefs; we decode them to
// the real target before they land in artifact sources[].
describe('canonicalizeDdgHref (gap 7)', () => {
  it('decodes a protocol-relative uddg redirect to the target url', () => {
    const href = '//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.ditestaedigola.com%2Flhome-cooking%2F&rut=abc';
    expect(canonicalizeDdgHref(href)).toBe('https://www.ditestaedigola.com/lhome-cooking/');
  });

  it('decodes an https uddg redirect', () => {
    const href = 'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx%3Fa%3D1';
    expect(canonicalizeDdgHref(href)).toBe('https://example.com/x?a=1');
  });

  it('leaves a direct (non-redirect) url untouched', () => {
    expect(canonicalizeDdgHref('https://example.com/page')).toBe('https://example.com/page');
  });

  it('protocol-normalizes a protocol-relative non-redirect url', () => {
    expect(canonicalizeDdgHref('//example.com/page')).toBe('https://example.com/page');
  });

  it('falls back gracefully on a malformed href', () => {
    expect(canonicalizeDdgHref('not a url')).toBe('not a url');
  });
});
