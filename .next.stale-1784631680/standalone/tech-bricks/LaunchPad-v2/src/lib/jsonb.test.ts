import { describe, it, expect } from 'vitest';
import { coerceJson, stripCharIndexKeys } from './jsonb';

describe('coerceJson', () => {
  it('passes objects through unchanged', () => {
    const o = { a: 1, b: 'x' };
    expect(coerceJson(o)).toBe(o);
  });

  it('passes arrays through unchanged', () => {
    const a = [{ x: 1 }, { y: 2 }];
    expect(coerceJson(a)).toBe(a);
  });

  it('parses a legacy double-encoded JSON-object string', () => {
    expect(coerceJson('{"tam":1,"sam":2}')).toEqual({ tam: 1, sam: 2 });
  });

  it('parses a legacy double-encoded JSON-array string', () => {
    expect(coerceJson('[{"a":1}]')).toEqual([{ a: 1 }]);
  });

  it('returns null for null/undefined', () => {
    expect(coerceJson(null)).toBeNull();
    expect(coerceJson(undefined)).toBeNull();
  });

  it('returns null for a non-JSON string instead of throwing', () => {
    expect(coerceJson('not json')).toBeNull();
  });
});

describe('stripCharIndexKeys', () => {
  it('removes numeric-string keys from a compounded dimensions object', () => {
    // the exact corruption shape seen in prod: char-index keys mixed with real keys
    const polluted = { '0': '{', '1': '}', 'Market Opportunity': 6.7, 'Feasibility': 6.7 };
    expect(stripCharIndexKeys(polluted)).toEqual({
      'Market Opportunity': 6.7,
      'Feasibility': 6.7,
    });
  });

  it('leaves a clean object untouched', () => {
    const clean = { Problem: 7.2, Market: 6.5 };
    expect(stripCharIndexKeys(clean)).toEqual(clean);
  });
});
