import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { en } from '@/lib/i18n/messages/en';
import { it as itMessages } from '@/lib/i18n/messages/it';

/**
 * The chat page on a phone, 2026-09-15.
 *
 * The chat column was `width: 440, flexShrink: 0` as an inline style. Beside the
 * 54px nav rail on a 390px screen it spanned 54→494px: Send sat past the right
 * edge and the canvas started off screen — the founder could neither send nor
 * reach the workspace. An inline width cannot be overridden by a media query, so
 * the width now lives in a class and narrow screens get a Chat / Workspace switch.
 *
 * Source-text pins (a DOM test cannot evaluate the media query), written so the
 * shape cannot come back.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const page = read('src/app/project/[projectId]/chat/page.tsx');
const css = read('src/styles/design-tokens.css');
const narrow = css.slice(css.indexOf('@media (max-width: 760px)'));

describe('the chat column can shrink on a narrow screen', () => {
  it('the 440px width is a class, not an inline style a media query cannot reach', () => {
    expect(page, 'inline width is back').not.toMatch(/width: 440\b/);
    expect(page).toMatch(/className="lp-chat-col"/);
    expect(css).toMatch(/\.lp-chat-col \{ width: 440px; flex-shrink: 0; \}/);
  });

  it('below the breakpoint the column is fluid', () => {
    expect(narrow).toMatch(/\.lp-chat-col \{ width: auto; flex: 1 1 0; min-width: 0; \}/);
  });

  it('the switch exists only on narrow screens — desktop is unchanged', () => {
    const desktop = css.slice(0, css.indexOf('@media (max-width: 760px)'));
    expect(desktop).toMatch(/\.lp-chat-pane-switch \{ display: none; \}/);
    expect(narrow).toMatch(/\.lp-chat-pane-switch \{ display: flex; \}/);
  });
});

describe('switching panes never loses the draft, scroll or stream', () => {
  it('the inactive pane is hidden with CSS, not unmounted', () => {
    // Unmounting the chat column would drop a half-typed message, the thread's
    // scroll position and the rendering of an in-flight stream.
    expect(page).toMatch(/data-pane=\{mobilePane\}/);
    expect(narrow).toMatch(/\[data-pane='workspace'\] \.lp-chat-col/);
    expect(narrow).toMatch(/\[data-pane='chat'\] \.lp-chat-canvas \{ display: none !important; \}/);
    expect(page, 'a pane is conditionally rendered').not.toMatch(/mobilePane === '(chat|workspace)' &&/);
    expect(page, 'a pane is conditionally rendered').not.toMatch(/mobilePane === '(chat|workspace)' \?\s*\(/);
  });
});

describe('canvas actions that fill the chat bring the chat into view', () => {
  it('the prompt handoff switches to Chat before focusing the composer', () => {
    const start = page.indexOf('onPickPrompt={(prompt, checkId)');
    const block = page.slice(start, start + 1600);
    const switchAt = block.indexOf('showChatPane()');
    const focusAt = block.indexOf('composerRef.current?.focus()');
    expect(switchAt, 'onPickPrompt does not switch panes').toBeGreaterThan(-1);
    expect(focusAt).toBeGreaterThan(-1);
    expect(switchAt, 'focus() on a hidden textarea is a no-op').toBeLessThan(focusAt);
  });

  it('the switch is flushed synchronously so focus() finds a visible textarea', () => {
    expect(page).toMatch(/flushSync\(\(\) => setMobilePane\('chat'\)\)/);
  });

  it('a skill click shows the chat its reply streams into', () => {
    const start = page.indexOf('onSkillClick={(label)');
    const block = page.slice(start, start + 700);
    expect(block.indexOf('showChatPane()')).toBeGreaterThan(-1);
    expect(block.indexOf('showChatPane()')).toBeLessThan(block.indexOf('sendMessage('));
  });
});

describe('switch copy is translated', () => {
  it('every key exists in en and it', () => {
    for (const key of ['chat.pane-switch-label', 'chat.pane-chat', 'chat.pane-workspace'] as const) {
      expect(en[key], `en missing ${key}`).toBeTruthy();
      expect(itMessages[key], `it missing ${key}`).toBeTruthy();
    }
  });
});
