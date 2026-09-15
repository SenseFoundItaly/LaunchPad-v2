import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pins that the graph copy of a founder note is the WHOLE note. The notes route
// accepted 4000 chars while this module wrote `noteText.slice(0, 1000)` into
// attributes.notes, so the Brainstorming tab — which renders that copy in full
// and never clips — showed a note silently missing its last 3000 chars.
const { queryMock, runMock, getMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  runMock: vi.fn(),
  getMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: queryMock, run: runMock, get: getMock }));
vi.mock('@/lib/knowledge/node-timeline', () => ({
  appendNodeTimeline: vi.fn(async () => undefined),
  timelineEntryNow: vi.fn((kind: string, headline: string) => ({ kind, headline })),
  historyLocale: vi.fn(async () => 'en'),
}));
vi.mock('@/lib/i18n/messages', () => ({ translate: vi.fn((_locale: string, key: string) => key) }));

import { routeNoteToGraph, NOTE_MAX_CHARS } from '@/lib/note-graph-routing';

/** The noteEntry objects written into attributes.notes (the `{notes}` UPDATE). */
const notesWrites = () =>
  runMock.mock.calls
    .filter(([sql]) => typeof sql === 'string' && sql.includes("'{notes}'"))
    .map(([, entry]) => entry as { text: string; truncated?: boolean; original_length?: number });

/** A note of exactly `len` chars that names the Greenio node. */
const noteOf = (len: number) => {
  const head = 'Greenio ha alzato i prezzi. ';
  return head + 'x'.repeat(len - head.length);
};

beforeEach(() => {
  vi.clearAllMocks();
  runMock.mockResolvedValue(undefined);
});

describe('routeNoteToGraph — note length', () => {
  it('keeps the product note limit at 4000 chars', () => {
    // Lowering this silently shrinks what founders can write; raising it grows
    // the focus-node prompt (chat buildFocusNodeContext serialises notes). Both
    // are product decisions, so the number is pinned.
    expect(NOTE_MAX_CHARS).toBe(4000);
  });

  it('writes a max-length note intact onto the node it names', async () => {
    queryMock.mockResolvedValue([{ id: 'node_greenio', name: 'Greenio' }]);
    const note = noteOf(NOTE_MAX_CHARS);

    const res = await routeNoteToGraph('proj_1', 'user_1', note);

    expect(res).toEqual({ attached: ['Greenio'], fallback: false });
    const [entry] = notesWrites();
    expect(entry.text).toHaveLength(NOTE_MAX_CHARS);
    expect(entry.text).toBe(note);
    expect(entry).not.toHaveProperty('truncated');
  });

  it('writes a max-length note intact into the Brainstorming bucket', async () => {
    queryMock.mockResolvedValue([]);
    getMock.mockResolvedValue({ id: 'node_bucket' });
    const note = 'Idea sparsa: ' + 'y'.repeat(NOTE_MAX_CHARS - 13);

    const res = await routeNoteToGraph('proj_1', 'user_1', note);

    expect(res).toEqual({ attached: [], fallback: true });
    const [entry] = notesWrites();
    expect(entry.text).toBe(note);
  });

  it('marks — never silently drops — text past the limit from a caller that skipped the route check', async () => {
    queryMock.mockResolvedValue([{ id: 'node_greenio', name: 'Greenio' }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const note = noteOf(NOTE_MAX_CHARS + 500);

    await routeNoteToGraph('proj_1', 'user_1', note);

    const [entry] = notesWrites();
    expect(entry.text).toBe(note.slice(0, NOTE_MAX_CHARS));
    expect(entry.truncated).toBe(true);
    expect(entry.original_length).toBe(NOTE_MAX_CHARS + 500);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
