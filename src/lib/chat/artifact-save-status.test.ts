import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createScenarios } from '../../../scripts/fixtures/copilot-ux.mjs';
import { artifactSaveStatus } from './artifact-save-status';
import { en } from '@/lib/i18n/messages/en';
import { it as itMessages } from '@/lib/i18n/messages/it';

/**
 * Pins the P1 from the 2026-09-13 copilot UI assessment: a knowledge card with
 * no record id sat on disabled Apply / Dismiss + "Saving proposal…" forever,
 * including every card of a discussion-only turn, where no record will ever
 * exist. "Saving" must only be claimed while an id can still arrive.
 */

const scenario = (key: string) => createScenarios().find((s) => s.key === key)!;
const user = (content: string) => ({ role: 'user', content });
const reply = (id: string) => ({ role: 'assistant', content: `:::artifact{"type":"insight-card","id":"${id}"}\n{"type":"insight-card","id":"${id}"}\n:::` });

describe('knowledge card save status', () => {
  it('the discussion fixture reads as never-saved, not as saving', () => {
    // The exact state the assessment reproduced: seeded history, no stream,
    // no persisted row.
    const { messages } = scenario('discussion');
    expect(artifactSaveStatus({ artifactId: 'discussion-table', persistedId: undefined, messages, isStreaming: false })).toBe('discussion-only');
  });

  it('a discussion-only card never claims to be saving, even mid-stream', () => {
    const { messages } = scenario('discussion');
    expect(artifactSaveStatus({ artifactId: 'discussion-table', persistedId: undefined, messages, isStreaming: true })).toBe('discussion-only');
  });

  it('follows the server policy per turn in Italian: only the final "non salvare" turn is discussion-only', () => {
    const { messages } = scenario('long-it');
    expect(artifactSaveStatus({ artifactId: 'latest-it', persistedId: undefined, messages, isStreaming: false })).toBe('discussion-only');
    expect(artifactSaveStatus({ artifactId: 'history-0', persistedId: undefined, messages, isStreaming: false })).toBe('unlinked');
  });

  it('a short continuation inherits the founder no-save scope, as on the server', () => {
    const messages = [user('Compare the options. Discussion only.'), { role: 'assistant', content: 'Shall I go on?' }, user('yes'), reply('a1')];
    expect(artifactSaveStatus({ artifactId: 'a1', persistedId: undefined, messages, isStreaming: false })).toBe('discussion-only');
  });

  it('is saving only while its own turn streams, and settles once the stream ends', () => {
    const messages = [user('Summarise the interview.'), reply('a1')];
    expect(artifactSaveStatus({ artifactId: 'a1', persistedId: undefined, messages, isStreaming: true })).toBe('saving');
    // useChat clears isStreaming only after broadcasting the final done
    // frame's ids — if none arrived, none is coming.
    expect(artifactSaveStatus({ artifactId: 'a1', persistedId: undefined, messages, isStreaming: false })).toBe('unlinked');
  });

  it('a card from an earlier turn is not "saving" because a newer turn streams', () => {
    const messages = [user('Summarise the interview.'), reply('old'), user('Now the pricing.'), { role: 'assistant', content: '' }];
    expect(artifactSaveStatus({ artifactId: 'old', persistedId: undefined, messages, isStreaming: true })).toBe('unlinked');
  });

  it('a follow-up merged after the streaming reply still belongs to the in-flight turn', () => {
    const messages = [user('Summarise the interview.'), reply('a1'), { role: 'assistant', content: 'follow-up' }];
    expect(artifactSaveStatus({ artifactId: 'a1', persistedId: undefined, messages, isStreaming: true })).toBe('saving');
  });

  it('a record id wins over everything', () => {
    const { messages } = scenario('discussion');
    expect(artifactSaveStatus({ artifactId: 'discussion-table', persistedId: 'gn_1', messages, isStreaming: false })).toBe('saved');
  });

  it('matches the exact id, not a prefix of another artifact id', () => {
    const messages = [user('Summarise.'), reply('a10')];
    expect(artifactSaveStatus({ artifactId: 'a1', persistedId: undefined, messages, isStreaming: true })).toBe('unlinked');
  });

  it('a card outside the thread, or without an id, is unlinked', () => {
    expect(artifactSaveStatus({ artifactId: 'x', persistedId: undefined, messages: [], isStreaming: true })).toBe('unlinked');
    expect(artifactSaveStatus({ artifactId: undefined, persistedId: undefined, messages: [user('Hi'), reply('x')], isStreaming: true })).toBe('unlinked');
  });
});

describe('the Apply / Dismiss footer renders the status honestly', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/chat/artifacts/SavedHint.tsx'), 'utf-8');

  it('never-saved and unlinked cards return before the Apply / Dismiss pair is rendered', () => {
    const pair = src.indexOf("t('kac.apply')");
    expect(pair).toBeGreaterThan(0);
    expect(src.indexOf("saveStatus === 'discussion-only'")).toBeGreaterThan(0);
    expect(src.indexOf("saveStatus === 'discussion-only'")).toBeLessThan(pair);
    expect(src.indexOf("saveStatus === 'unlinked'")).toBeGreaterThan(0);
    expect(src.indexOf("saveStatus === 'unlinked'")).toBeLessThan(pair);
  });

  it('"Saving proposal…" is gated on the saving status, not on a missing id', () => {
    expect(src).toContain("saveStatus === 'saving' && (");
    expect(src).not.toMatch(/!itemId && \(\s*<span[^>]*>\{t\('kac\.saving-proposal'\)\}/);
  });

  it('the new states are translated in both catalogs', () => {
    for (const key of ['kac.not-saved-discussion', 'kac.nothing-to-apply', 'kac.review-in-knowledge'] as const) {
      expect(en[key]).toBeTruthy();
      expect(itMessages[key]).toBeTruthy();
    }
  });
});
