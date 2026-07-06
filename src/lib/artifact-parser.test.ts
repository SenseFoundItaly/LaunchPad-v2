import { describe, it, expect } from 'vitest';
import { parseMessageContent, normalizeCanvasJsonFences } from '@/lib/artifact-parser';

// B2: the provenance gate is the moat — an artifact type in
// ARTIFACTS_REQUIRING_SOURCES must carry non-empty sources[] or it's rejected
// to an artifact-error (visible), never silently rendered. These tests pin that
// behavior so a parser tweak can't quietly let unsourced claims through.
const sourced = (extra = '') =>
  `:::artifact{"type":"insight-card","id":"ins_1"}\n{"category":"market","title":"T","body":"B","confidence":"high"${extra},"sources":[{"type":"web","title":"Ex","url":"https://example.com"}]}\n:::`;
const unsourced =
  `:::artifact{"type":"insight-card","id":"ins_2"}\n{"category":"market","title":"T","body":"B","confidence":"high"}\n:::`;

describe('parseMessageContent', () => {
  it('returns plain prose as a text segment', () => {
    const segs = parseMessageContent('Just some advice, no artifacts here.');
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('text');
  });

  it('accepts a sourced artifact (insight-card with sources[])', () => {
    const segs = parseMessageContent(`Here is an insight.\n${sourced()}`);
    const art = segs.find((s) => s.type === 'artifact');
    expect(art).toBeTruthy();
  });

  it('REJECTS a source-required artifact with no sources → artifact-error (provenance moat)', () => {
    const segs = parseMessageContent(unsourced);
    const err = segs.find((s) => s.type === 'artifact-error');
    expect(err).toBeTruthy();
    // and it must NOT have leaked through as a renderable artifact
    expect(segs.find((s) => s.type === 'artifact')).toBeFalsy();
  });

  it('treats an unterminated artifact block as pending (streaming), not text/leak', () => {
    const segs = parseMessageContent(`thinking…\n:::artifact{"type":"insight-card","id":"ins_3"}\n{"title":"partial`);
    expect(segs.some((s) => s.type === 'artifact-pending')).toBe(true);
  });
});

// 3B (changelog 05/07): the model sometimes leaks a canvas reshape as a raw
// ```json fence (or a bare {"idea_canvas":...} wrapper inside one) instead of
// an idea-canvas artifact. The normalizer pre-pass rescues COMPLETE fences into
// real artifacts so render + persistence + Canvas all see one shape.
const canvasJson = JSON.stringify({
  problem: 'Founders lose track of validation evidence',
  solution: 'A guided validation co-pilot',
  target_market: 'First-time founders',
});
const fenced = (body: string, lang = 'json') => '```' + lang + '\n' + body + '\n```';

describe('normalizeCanvasJsonFences', () => {
  it('rewrites a complete ```json canvas fence into an idea-canvas artifact', () => {
    const out = normalizeCanvasJsonFences(`Here is the reshaped canvas:\n${fenced(canvasJson)}`);
    expect(out).toContain(':::artifact{"type":"idea-canvas","id":"ic_json_');
    expect(out).not.toContain('```');
    const segs = parseMessageContent(`Here is the reshaped canvas:\n${fenced(canvasJson)}`);
    const art = segs.find((s) => s.type === 'artifact');
    expect(art).toBeTruthy();
    expect((art as { artifact: { type: string; problem?: string } }).artifact.type).toBe('idea-canvas');
    expect((art as { artifact: { problem?: string } }).artifact.problem).toContain('lose track');
  });

  it('unwraps a single top-level idea_canvas key', () => {
    const wrapped = JSON.stringify({ idea_canvas: JSON.parse(canvasJson) });
    const segs = parseMessageContent(fenced(wrapped));
    const art = segs.find((s) => s.type === 'artifact');
    expect(art).toBeTruthy();
    const a = (art as unknown as { artifact: Record<string, unknown> }).artifact;
    expect(a.type).toBe('idea-canvas');
    expect(a.solution).toBe('A guided validation co-pilot');
    expect(a.idea_canvas).toBeUndefined();
  });

  it('keeps the artifact id STABLE across re-parses of the same content', () => {
    const a = normalizeCanvasJsonFences(fenced(canvasJson));
    const b = normalizeCanvasJsonFences(fenced(canvasJson));
    expect(a).toBe(b);
  });

  it('leaves non-canvas JSON fences untouched', () => {
    const other = fenced(JSON.stringify({ metrics: [1, 2, 3], label: 'MRR' }));
    expect(normalizeCanvasJsonFences(other)).toBe(other);
    // fewer than 2 core canvas keys → not a canvas
    const oneKey = fenced(JSON.stringify({ problem: 'only one core key' }));
    expect(normalizeCanvasJsonFences(oneKey)).toBe(oneKey);
  });

  it('leaves an unterminated (still-streaming) fence untouched', () => {
    const streaming = 'Reshaping…\n```json\n{"problem":"partial","solution":"still arr';
    expect(normalizeCanvasJsonFences(streaming)).toBe(streaming);
  });

  it('normalizes the canvas fence even when an earlier non-json fence precedes it (fence pairing)', () => {
    // Regression: a json-only regex paired the ts block's CLOSING backticks
    // with the canvas block's OPENING backticks, so the canvas stayed raw.
    const mixed = `Some code first:\n${fenced('let x = 1;', 'ts')}\nAnd the reshaped canvas:\n${fenced(canvasJson)}`;
    const out = normalizeCanvasJsonFences(mixed);
    expect(out).toContain(':::artifact{"type":"idea-canvas","id":"ic_json_');
    expect(out).toContain('```ts\nlet x = 1;\n```'); // the code fence survives verbatim
  });
});
