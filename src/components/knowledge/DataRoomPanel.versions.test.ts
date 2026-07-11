import { describe, it, expect } from 'vitest';
import { presentItems, type DataRoomItem } from '@/components/knowledge/DataRoomPanel';

// Implicit versioning: build_artifacts rows sharing doc_type + normalized
// title ARE the version history (each regeneration is a fresh INSERT). These
// tests pin the numbering (oldest = v1), the singleton/no-badge rule, and
// that uploads never version.

function item(over: Partial<DataRoomItem>): DataRoomItem {
  return {
    id: 'x',
    source: 'generated',
    kind: 'document',
    title: 'Pitch deck',
    doc_type: 'pitch-deck',
    created_at: '2026-07-01T00:00:00Z',
    size_bytes: null,
    mime: null,
    has_editable_content: true,
    extraction: null,
    ...over,
  };
}

describe('data-room implicit versioning', () => {
  it('numbers same-title generated docs v1..vN by creation order, list order untouched', () => {
    const items = [
      item({ id: 'c', created_at: '2026-07-03T00:00:00Z' }), // newest first, like the API
      item({ id: 'b', created_at: '2026-07-02T00:00:00Z' }),
      item({ id: 'a', created_at: '2026-07-01T00:00:00Z' }),
    ];
    const out = presentItems(items);
    expect(out.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(out.map((p) => p.versionBadge)).toEqual(['v3', 'v2', 'v1']);
  });

  it('gives singletons no badge', () => {
    const out = presentItems([item({ id: 'only' })]);
    expect(out[0].versionBadge).toBeNull();
  });

  it('groups by normalized title within a doc type', () => {
    const out = presentItems([
      item({ id: 'a', title: 'Pitch Deck ', created_at: '2026-07-01T00:00:00Z' }),
      item({ id: 'b', title: 'pitch deck', created_at: '2026-07-02T00:00:00Z' }),
      item({ id: 'c', title: 'One pager', doc_type: 'one-pager', created_at: '2026-07-03T00:00:00Z' }),
    ]);
    expect(out.find((p) => p.id === 'a')?.versionBadge).toBe('v1');
    expect(out.find((p) => p.id === 'b')?.versionBadge).toBe('v2');
    expect(out.find((p) => p.id === 'c')?.versionBadge).toBeNull();
  });

  it('same title but different doc_type does NOT group', () => {
    const out = presentItems([
      item({ id: 'a', doc_type: 'pitch-deck' }),
      item({ id: 'b', doc_type: 'one-pager' }),
    ]);
    expect(out.every((p) => p.versionBadge === null)).toBe(true);
  });

  it('uploads never version, even with identical titles', () => {
    const out = presentItems([
      item({ id: 'a', source: 'uploaded', kind: 'file_upload', doc_type: null, title: 'notes.pdf' }),
      item({ id: 'b', source: 'uploaded', kind: 'file_upload', doc_type: null, title: 'notes.pdf', created_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(out.every((p) => p.versionBadge === null)).toBe(true);
  });
});
