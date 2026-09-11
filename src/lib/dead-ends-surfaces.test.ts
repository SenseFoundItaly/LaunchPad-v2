import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Dead-end audit, second pass (2026-09-10) — two classes the first pass did
 * not cover, each pinned as a SCAN rather than an instance, so the next one
 * fails the suite instead of waiting for a founder to find it.
 *
 *   9.  A card button that fires an action nothing handles. handleArtifactAction
 *       has no default branch: an unknown action falls off the end and the
 *       click does nothing. Measured: workflow-card step ticks, live on 80
 *       cards across 39 projects, were lost on every reload.
 *   10. A link to a project page that does not exist. Caught my own #477
 *       sending `navigate_to: 'canvas'` to /canvas — the canvas is a pane of
 *       /chat.
 */

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(e.name) && !e.name.includes('.test.')) out.push(rel);
  }
  return out;
}

describe('class 9 — every action a card can fire has a handler', () => {
  // Known debt, each with the reason it is tolerated. Add here ONLY with a
  // reason; an unlisted unhandled action is a new dead end.
  const KNOWN_UNHANDLED: Record<string, string> = {
    'approval:answer': 'ApprovalRequestCard — the agent has never emitted this type on prod (0 messages)',
    'recommendation:accept': 'RecommendationArtifactCard — never emitted on prod (0 messages)',
    'sensitivity-update': 'SensitivitySliderCard — 2 messages, both June 2026; slider is local-only by design',
  };

  it('no card fires an action the chat page does not handle', () => {
    const page = read('src/app/project/[projectId]/chat/page.tsx');
    const handled = new Set([...page.matchAll(/action === '([a-z_:-]+)'/g)].map((m) => m[1]));
    const emitted = new Map<string, string[]>();
    for (const f of [...walk('src/components/chat'), 'src/app/project/[projectId]/chat/page.tsx']) {
      for (const m of read(f).matchAll(/onAction\??\.?\(\s*'([a-z_:-]+)'/g)) {
        emitted.set(m[1], [...(emitted.get(m[1]) ?? []), f]);
      }
    }
    const unhandled = [...emitted.keys()].filter((a) => !handled.has(a) && !(a in KNOWN_UNHANDLED));
    expect(unhandled, `unhandled card actions: ${unhandled.map((a) => `${a} <- ${emitted.get(a)}`).join('; ')}`).toEqual([]);
  });

  it('the workflow card no longer fires into the void — it persists its own ticks', () => {
    const card = read('src/components/chat/artifacts/WorkflowCardInline.tsx');
    expect(card).not.toMatch(/onAction\(\s*'workflow-progress'/);
    expect(card).toMatch(/localStorage\.getItem\(storageKey\)/);
    expect(card).toMatch(/localStorage\.setItem\(storageKey/);
    // Storage can throw (private mode) — neither side may take the card down.
    expect((card.match(/catch \{/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('class 10 — every in-app link points at a page that exists', () => {
  it('no /project/{id}/<segment> target without a page.tsx', () => {
    const base = 'src/app/project/[projectId]';
    const pages = new Set(
      readdirSync(join(ROOT, base), { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(ROOT, base, e.name, 'page.tsx')))
        .map((e) => e.name),
    );
    const bad: string[] = [];
    for (const f of [...walk('src/app'), ...walk('src/components'), ...walk('src/hooks'), ...walk('src/lib')]) {
      for (const m of read(f).matchAll(/\/project\/\$\{[a-zA-Z_.?]+\}\/([a-z-]+)/g)) {
        if (!pages.has(m[1])) bad.push(`/${m[1]} in ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the canvas destination resolves to the chat page, where the canvas lives', () => {
    expect(read('src/app/project/[projectId]/chat/page.tsx')).toMatch(/canvas: `\/project\/\$\{projectId\}\/chat`/);
  });
});
