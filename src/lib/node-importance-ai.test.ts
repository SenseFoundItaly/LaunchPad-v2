import { describe, it, expect } from 'vitest';
import { cleanImportance } from './node-importance-ai';

describe('cleanImportance', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanImportance('  Anchors your   market\n opportunity. ')).toBe('Anchors your market opportunity.');
  });

  it('strips wrapping quotes / markdown', () => {
    expect(cleanImportance('"This sizes your raise."')).toBe('This sizes your raise.');
    expect(cleanImportance('- **Maps the competitive landscape**')).toBe('Maps the competitive landscape');
  });

  it('clamps overlong output at a word boundary with an ellipsis', () => {
    const long = 'word '.repeat(80).trim(); // ~400 chars
    const out = cleanImportance(long)!;
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toContain('  ');
  });

  it('rejects too-short / non-string', () => {
    expect(cleanImportance('ok')).toBeNull();
    expect(cleanImportance('')).toBeNull();
    expect(cleanImportance(null)).toBeNull();
    expect(cleanImportance(42 as unknown)).toBeNull();
  });
});
