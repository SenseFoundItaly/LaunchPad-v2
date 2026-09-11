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

// Gap C grouping fix: chat artifacts are re-emitted incidentally across turns.
// Same (kind, title) collapses to the NEWEST row with a ×N count badge — NOT a
// v1..vN history like generated docs (those are deliberate regenerations).
function chatItem(over: Partial<DataRoomItem>): DataRoomItem {
  return {
    id: 'x', source: 'chat_artifact', kind: 'comparison-table', title: 'Competitors',
    doc_type: null, created_at: '2026-07-01T00:00:00Z', size_bytes: null, mime: null,
    has_editable_content: false, extraction: null, ...over,
  };
}

describe('data-room chat-artifact grouping (gap C)', () => {
  it('collapses re-emitted (kind, title) to the newest row with a ×N badge', () => {
    const out = presentItems([
      chatItem({ id: 'new', created_at: '2026-07-03T00:00:00Z' }),
      chatItem({ id: 'mid', created_at: '2026-07-02T00:00:00Z' }),
      chatItem({ id: 'old', created_at: '2026-07-01T00:00:00Z' }),
    ]);
    expect(out).toHaveLength(1);           // 3 collapse to 1
    expect(out[0].id).toBe('new');          // newest kept
    expect(out[0].versionBadge).toBe('×3'); // count badge
  });

  it('does NOT collapse different titles or different kinds', () => {
    const out = presentItems([
      chatItem({ id: 'a', title: 'Competitors' }),
      chatItem({ id: 'b', title: 'Pricing' }),
      chatItem({ id: 'c', kind: 'risk-matrix', title: 'Competitors' }),
    ]);
    expect(out).toHaveLength(3);
    expect(out.every((p) => p.versionBadge === null)).toBe(true); // singletons, no badge
  });

  it('a lone chat artifact gets no badge', () => {
    const out = presentItems([chatItem({ id: 'solo' })]);
    expect(out).toHaveLength(1);
    expect(out[0].versionBadge).toBeNull();
  });

  it('does NOT merge generic fallback titles (fix #5): two untitled comparisons stay separate', () => {
    const out = presentItems([
      chatItem({ id: 'a', title: 'Comparison', created_at: '2026-07-01T00:00:00Z' }),
      chatItem({ id: 'b', title: 'Comparison', created_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(out).toHaveLength(2); // generic title → no collapse
    expect(out.every((p) => p.versionBadge === null)).toBe(true);
  });

  it('expands a collapsed group to v1..vN when its key is in expandedChatGroups (fix #4)', () => {
    const items = [
      chatItem({ id: 'new', created_at: '2026-07-03T00:00:00Z' }),
      chatItem({ id: 'mid', created_at: '2026-07-02T00:00:00Z' }),
      chatItem({ id: 'old', created_at: '2026-07-01T00:00:00Z' }),
    ];
    const key = 'comparison-table::competitors';
    const out = presentItems(items, new Set([key]));
    expect(out).toHaveLength(3); // all shown when expanded
    expect(out.find((p) => p.id === 'old')?.versionBadge).toBe('v1');
    expect(out.find((p) => p.id === 'mid')?.versionBadge).toBe('v2');
    expect(out.find((p) => p.id === 'new')?.versionBadge).toBe('v3');
    // every expanded row carries the group key so a badge click re-collapses.
    expect(out.every((p) => p.chatGroupKey === key)).toBe(true);
  });
});
