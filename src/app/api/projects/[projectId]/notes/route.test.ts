import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The note-length limit is ONE constant (NOTE_MAX_CHARS) read by both this
 * route and the graph routing. It used to be two literals — 4000 here, 1000 in
 * note-graph-routing.ts — so a note the route accepted was silently cut on the
 * graph. These tests pin the handoff: the route accepts exactly the shared
 * limit, and passes the full note on to routing untouched.
 */

const { accessMock, factMock, extractMock, routeMock } = vi.hoisted(() => ({
  accessMock: vi.fn(),
  factMock: vi.fn(),
  extractMock: vi.fn(),
  routeMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ query: vi.fn(), run: vi.fn(), get: vi.fn() }));
vi.mock('@/lib/auth/require-project-access', () => ({ tryProjectAccess: accessMock }));
vi.mock('@/lib/memory/facts', () => ({ recordFact: factMock }));
vi.mock('@/lib/note-entity-extract', () => ({ extractEntitiesFromNote: extractMock }));
vi.mock('@/lib/project-tools', () => ({ stageValidationProposal: vi.fn() }));
// Keep the REAL NOTE_MAX_CHARS — the point is that the route reads the same
// constant routing does; only the DB-touching routing function is stubbed.
vi.mock('@/lib/note-graph-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/note-graph-routing')>()),
  routeNoteToGraph: routeMock,
}));

import { POST } from '@/app/api/projects/[projectId]/notes/route';
import { NOTE_MAX_CHARS } from '@/lib/note-graph-routing';

const params = Promise.resolve({ projectId: 'proj_1' });
const post = (note: string) =>
  POST(
    new Request('http://localhost/api/projects/proj_1/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }) as never,
    { params },
  );

beforeEach(() => {
  vi.clearAllMocks();
  accessMock.mockResolvedValue({ ok: true, session: { userId: 'user_1' } });
  factMock.mockResolvedValue('fact_1');
  extractMock.mockResolvedValue({ competitors: [], facts: [] });
  routeMock.mockResolvedValue({ attached: [], fallback: true });
});

describe('POST /notes — shared note-length limit', () => {
  it('accepts a note of exactly NOTE_MAX_CHARS and hands the full text to memory and routing', async () => {
    const note = 'n'.repeat(NOTE_MAX_CHARS);

    const res = await post(note);

    expect(res.status).toBe(201);
    expect(factMock).toHaveBeenCalledWith(expect.objectContaining({ fact: note, kind: 'note' }));
    expect(routeMock).toHaveBeenCalledWith('proj_1', 'user_1', note, []);
  });

  it('rejects NOTE_MAX_CHARS + 1 before anything is saved, naming the shared limit', async () => {
    const res = await post('n'.repeat(NOTE_MAX_CHARS + 1));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(String(NOTE_MAX_CHARS));
    expect(factMock).not.toHaveBeenCalled();
    expect(routeMock).not.toHaveBeenCalled();
  });

  it('keeps no private length literal in either the route or the routing graph copy', () => {
    // A behavioural test cannot see a second literal that happens to equal the
    // constant today; this catches the drift the moment it is reintroduced.
    const routeSrc = readFileSync(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');
    const routingSrc = readFileSync(
      fileURLToPath(new URL('../../../../../lib/note-graph-routing.ts', import.meta.url)),
      'utf8',
    );
    expect(routeSrc).toMatch(/import \{[^}]*\bNOTE_MAX_CHARS\b[^}]*\} from '@\/lib\/note-graph-routing'/);
    // Scoped to the note's own `text` — `items.length > 0` elsewhere is not a limit.
    expect(routeSrc).not.toMatch(/\btext\.length\s*>\s*\d/);
    expect(routingSrc).not.toMatch(/noteText\.slice\(0,\s*\d{4,}\)/);
    expect(routingSrc).toMatch(/noteText\.slice\(0,\s*NOTE_MAX_CHARS\)/);
  });
});
