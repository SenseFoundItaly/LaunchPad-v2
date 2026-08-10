import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hasUncitedProseClaim } from './llm/turn-violations';

/**
 * The trust surface of an agent message (2026-08-09 legibility audit).
 *
 * Measured on 981 real artifacts first: EVIDENTIAL cards already carry sources
 * 89% of the time (tam-sam-som, entity-card, monitor-proposal at 100%), so the
 * gap was never "add sources" — it was that the three signals the system had
 * ALREADY computed were shown to nobody:
 *   1. the uncited-number flag existed only to scold the model next turn,
 *   2. a rejected card vanished while the prose kept narrating it,
 *   3. the raw <CITATIONS> block leaked to screen as machine noise
 *      (12 stored prod messages carry one).
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const CHAT_PAGE = 'src/app/project/[projectId]/chat/page.tsx';

describe('the uncited-number flag reaches the founder', () => {
  it('the detector still fires on a hard figure with no citation', () => {
    expect(hasUncitedProseClaim('Il mercato vale €310M e cresce del 12% annuo')).toBe(true);
    // …and stays quiet when the claim is cited.
    expect(hasUncitedProseClaim('Il mercato vale €310M [2] e cresce del 12% [2]')).toBe(false);
  });

  it('the stream carries it on the done event', () => {
    const route = read('src/app/api/chat/route.ts');
    expect(route).toContain('donePayload.uncited_claims = true;');
    expect(route).toContain('uncitedClaims = violations.uncited_prose_claims;');
  });

  it('the client keeps it live AND across a reload', () => {
    expect(read('src/hooks/useChat.ts')).toMatch(/parsed\.done && parsed\.uncited_claims/);
    // History path: the flag lives in chat_messages.meta.
    expect(read(CHAT_PAGE)).toContain('uncited_prose_claims');
  });

  it('renders a caption rather than staying silent', () => {
    const page = read(CHAT_PAGE);
    expect(page).toMatch(/uncitedClaims &&[\s\S]{0,600}chat\.uncited-claim/);
    for (const f of ['src/lib/i18n/messages/it.ts', 'src/lib/i18n/messages/en.ts']) {
      expect(read(f)).toContain("'chat.uncited-claim'");
    }
  });
});

describe('a rejected card is never silent', () => {
  it('classifyArtifacts keeps the parser\'s artifact-error segments', () => {
    const page = read(CHAT_PAGE);
    expect(page).toMatch(/filter\(\(s\) => s\.type === 'artifact-error'\)/);
  });

  it('the bubble renders them with a localized reason', () => {
    const page = read(CHAT_PAGE);
    expect(page).toMatch(/artifactErrors[\s\S]{0,900}chat\.card-rejected/);
    for (const f of ['src/lib/i18n/messages/it.ts', 'src/lib/i18n/messages/en.ts']) {
      expect(read(f)).toContain("'chat.card-rejected'");
    }
  });
});

describe('no machine noise in the prose column', () => {
  it('stripArtifacts removes a CITATIONS block, closed or unterminated', () => {
    const page = read(CHAT_PAGE);
    // Reproduce the shipped strip and prove it on both forms, rather than
    // asserting on the regex source (unreadable, and it would pass on a broken
    // pattern that merely LOOKS right).
    const stripBlock = (txt: string) => txt.replace(/<CITATIONS>[\s\S]*?(?:<\/CITATIONS>|$)/g, '').trim();
    expect(page).toContain('<CITATIONS>'); // the strip must still be in place

    const closed = 'Il mercato cresce.\n<CITATIONS>[{"type":"web","url":"https://x"}]</CITATIONS>';
    expect(stripBlock(closed)).toBe('Il mercato cresce.');

    // Stream cut mid-block: without the `|$` alternative the whole tail leaks.
    const truncated = 'Il mercato cresce.\n<CITATIONS>[{"type":"web","url":"https://x"';
    expect(stripBlock(truncated)).toBe('Il mercato cresce.');
  });
});
