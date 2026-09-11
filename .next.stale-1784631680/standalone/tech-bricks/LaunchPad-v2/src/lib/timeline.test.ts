import { describe, it, expect } from 'vitest';
import { coerceTimeline } from './timeline';

describe('coerceTimeline', () => {
  const entry = { date: '2026-07-03T00:00:00.000Z', headline: 'Slack shipped huddles', alert_id: 'ea_1' };

  it('returns a proper array unchanged (stored order)', () => {
    const a = { date: '2026-01-01', headline: 'A' };
    const b = { date: '2026-02-01', headline: 'B' };
    expect(coerceTimeline([a, b])).toEqual([a, b]);
  });

  it('parses a legacy DOUBLE-ENCODED jsonb string scalar', () => {
    // postgres.js reads a double-encoded column back as a string; must survive.
    const doubleEncoded = JSON.stringify([entry]);
    expect(coerceTimeline(doubleEncoded)).toEqual([entry]);
  });

  it('drops elements that are not well-formed entries', () => {
    const mixed = [entry, null, 42, 'x', {}, { headline: 5 }, { headline: 'ok' }];
    expect(coerceTimeline(mixed)).toEqual([entry, { headline: 'ok' }]);
  });

  it('returns [] for a non-array (object, null, undefined) and for bad JSON', () => {
    expect(coerceTimeline({ headline: 'not an array' })).toEqual([]);
    expect(coerceTimeline(null)).toEqual([]);
    expect(coerceTimeline(undefined)).toEqual([]);
    expect(coerceTimeline('{not json')).toEqual([]);
    // A JSON string that parses to a non-array is also rejected.
    expect(coerceTimeline('"just a string"')).toEqual([]);
  });
});
