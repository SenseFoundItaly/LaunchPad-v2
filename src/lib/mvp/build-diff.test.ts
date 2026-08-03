import { describe, it, expect } from 'vitest';
import { diffFileHashes } from './build-diff';

describe('diffFileHashes', () => {
  it('reports nothing without a previous snapshot (a create is not "all added")', () => {
    expect(diffFileHashes(null, { 'a.tsx': '1' })).toEqual([]);
  });

  it('detects modified / added / deleted', () => {
    const prev = { 'page.tsx': 'a1', 'nav.tsx': 'b1', 'old.tsx': 'c1' };
    const next = { 'page.tsx': 'a2', 'nav.tsx': 'b1', 'new.tsx': 'd1' };
    expect(diffFileHashes(prev, next)).toEqual([
      { path: 'page.tsx', change: 'modified' },
      { path: 'new.tsx', change: 'added' },
      { path: 'old.tsx', change: 'deleted' },
    ]);
  });

  it('unchanged files are omitted', () => {
    expect(diffFileHashes({ 'a.tsx': '1' }, { 'a.tsx': '1' })).toEqual([]);
  });

  it('handles a missing next snapshot', () => {
    expect(diffFileHashes({ 'a.tsx': '1' }, undefined)).toEqual([]);
  });
});
