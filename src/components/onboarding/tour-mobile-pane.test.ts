import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildDemoManifest, buildManifest } from './tour-steps';
import { chatPaneForTourTarget } from './tour-state';

/**
 * The onboarding tour on a phone, 2026-09-15.
 *
 * PR #488 gave narrow screens a Chat / Workspace switch that hides the inactive
 * pane with display:none. The tour's chat-canvas step targets the canvas, which
 * sits in the hidden Workspace pane while Chat (the default) is showing. A hidden
 * element still matches querySelector, so the optional step was not skipped:
 * driver.js measured an all-zero rect and parked the spotlight and popover in the
 * top-left corner, describing a canvas the founder could not see.
 *
 * The fix reveals the pane each step points at, just before driver.js measures.
 * A DOM test cannot evaluate the media query or driver.js's positioning, so the
 * wiring is pinned on source text and the pane choice on the pure helper.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');
const controller = read('src/components/onboarding/TourController.tsx');
const chatPage = read('src/app/project/[projectId]/chat/page.tsx');

describe('which pane a tour step needs', () => {
  it('the canvas step shows the Workspace pane', () => {
    expect(chatPaneForTourTarget('[data-tour="chat-canvas"]')).toBe('workspace');
  });

  it('every other step shows Chat, so Prev from the canvas step goes back', () => {
    expect(chatPaneForTourTarget('[data-tour="chat-composer"]')).toBe('chat');
    expect(chatPaneForTourTarget('[data-tour="nav-chat"]')).toBe('chat');
    expect(chatPaneForTourTarget(undefined)).toBe('chat');
  });

  it('the helper matches the selector the manifest actually uses', () => {
    // If the step's selector is renamed, the helper would silently stop matching
    // and the canvas step would land in the corner again.
    const canvas = buildManifest({ hasProjects: true }).find((s) => s.id === 'chat-canvas');
    expect(canvas?.target).toBeDefined();
    expect(chatPaneForTourTarget(canvas?.target)).toBe('workspace');
  });

  it('the Co-pilot chapter has no step besides the canvas that lives in the Workspace pane', () => {
    const chat = buildManifest({ hasProjects: true }).filter((s) => s.page === 'chat');
    expect(chat.map((s) => s.id)).toEqual(['nav-chat', 'chat-composer', 'chat-canvas']);
  });
});

describe('the tour tells the page before driver.js measures', () => {
  it('the controller announces each step from onHighlightStarted', () => {
    // onHighlightStarted runs before driver.js reads the element's rect, for
    // drive(), Next and Prev alike; onHighlighted would be too late.
    const start = controller.indexOf('onHighlightStarted:');
    expect(start, 'the step announcement is gone').toBeGreaterThan(-1);
    expect(controller.slice(start, start + 400)).toMatch(/dispatchEvent\(\s*new CustomEvent<TourHighlightDetail>\(TOUR_HIGHLIGHT_EVENT/);
  });

  it('the chat page listens and switches panes synchronously', () => {
    expect(chatPage).toMatch(/addEventListener\(TOUR_HIGHLIGHT_EVENT/);
    expect(chatPage).toMatch(/removeEventListener\(TOUR_HIGHLIGHT_EVENT/);
    // Without flushSync the pane is still hidden when driver.js measures.
    const start = chatPage.indexOf('const onTourHighlight');
    expect(start, 'the tour listener is gone').toBeGreaterThan(-1);
    const block = chatPage.slice(start, start + 300);
    expect(block).toMatch(/const pane = chatPaneForTourTarget\(/);
    expect(block).toMatch(/flushSync\(\(\) => setMobilePane\(pane\)\)/);
  });
});

describe('the demo is not affected', () => {
  it('the demo chat page has no pane switch, so its canvas is never display:none', () => {
    // The demo reuses the chat-canvas step. If it ever gains the pane switch,
    // it needs the same listener.
    const demo = read('src/app/demo/chat/page.tsx');
    expect(buildDemoManifest().some((s) => s.id === 'chat-canvas')).toBe(true);
    expect(demo).not.toMatch(/lp-chat-shell|data-pane/);
  });
});
