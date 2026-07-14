import { describe, it, expect } from 'vitest';
import { computeDedupHash } from '@/lib/monitor-dedup';

// Pins the black-swan sibling-hash fix (2026-07-10 gap audit H2): all 5
// scenario watchers used to stage with urls_to_track: [] and NO query, so
// every one hashed to the same H("#") and the apply-time L1.3 exact-hash
// dedup let only the FIRST approval through. Scenarios now carry their title
// as the query, and checkDedup skips L1.3 for degenerate empty-input hashes.
describe('computeDedupHash — prompt-only watcher siblings (audit H2)', () => {
  it('distinct scenario queries produce distinct hashes with no urls', () => {
    const a = computeDedupHash([], 'OpenAI ships a free tier of our exact use case');
    const b = computeDedupHash([], 'EU AI Act reclassifies the data model as illegal');
    const c = computeDedupHash([], 'Key founding engineer leaves before the launch');
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('documents the degenerate empty-input hash the L1.3 skip guards against', () => {
    // Empty urls + empty/absent query all collapse to one hash — this is WHY
    // checkDedup must not exact-match on it (see monitor-dedup.ts L1.3 guard).
    expect(computeDedupHash([], undefined)).toBe(computeDedupHash(undefined, ''));
    expect(computeDedupHash([], '   ')).toBe(computeDedupHash([], ''));
  });

  it('query normalization still dedups true duplicates', () => {
    expect(computeDedupHash([], 'Watch   HubSpot')).toBe(computeDedupHash([], 'watch hubspot'));
  });
});
