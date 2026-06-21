import { describe, it, expect } from 'vitest';
import { parseMessageContent } from '@/lib/artifact-parser';

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
