import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildDemoManifest, buildManifest, demoRouteFor, routeForMode } from './tour-steps';

/**
 * The public /demo walkthrough reuses the signed-in tour's engine, copy and
 * step ids, but runs over a SEPARATE shell: src/app/demo/* is its own chrome
 * (not src/components/design/chrome.tsx), so nothing the app renders guarantees
 * the demo renders it too.
 *
 * That is the seam these tests hold. A manifest step whose `data-tour` anchor
 * is missing from the demo tree does not throw — driver.js silently falls back
 * to a centered popover, or an optional step skips — so the tour degrades into
 * a slideshow of unanchored text and nobody notices. Every other test here
 * pins a demo-vs-app divergence that would be invisible at runtime.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf-8');

const DEMO_FILES = [
  'src/app/demo/chrome.tsx',
  'src/app/demo/sections.tsx',
  'src/app/demo/page.tsx',
  'src/app/demo/knowledge/page.tsx',
  'src/app/demo/chat/page.tsx',
  'src/app/demo/inbox/page.tsx',
  'src/app/demo/financial/page.tsx',
];

/** Every anchor the demo actually renders, including the rail's templated ids. */
function demoAnchors(): Set<string> {
  const found = new Set<string>();
  for (const f of DEMO_FILES) {
    const src = read(f);
    for (const m of src.matchAll(/data-tour="([^"]+)"/g)) found.add(m[1]);
    // The rail renders data-tour={`nav-${e.id}`} — expand from the nav entries.
    if (/data-tour=\{`nav-\$\{e\.id\}`\}/.test(src)) {
      for (const m of src.matchAll(/^\s*id: '([a-z-]+)', href: '\/demo/gm)) found.add(`nav-${m[1]}`);
    }
  }
  return found;
}

const anchorOf = (target: string): string | undefined => target.match(/data-tour="([^"]+)"/)?.[1];

describe('the demo tour is anchored to things the demo actually renders', () => {
  it('every targeted step has its data-tour anchor in the demo tree', () => {
    const anchors = demoAnchors();
    const missing = buildDemoManifest()
      .filter((s) => s.target)
      .map((s) => ({ id: s.id, attr: anchorOf(s.target!) }))
      .filter((s) => !s.attr || !anchors.has(s.attr));
    expect(missing, `unanchored demo steps: ${JSON.stringify(missing)}`).toEqual([]);
  });

  it('targets are data-tour selectors only — never CSS structure', () => {
    for (const s of buildDemoManifest()) {
      if (s.target) expect(s.target, s.id).toMatch(/^\[data-tour="[a-z-]+"\]$/);
    }
  });

  it('every chapter route is a real public demo page', () => {
    const pages = [...new Set(buildDemoManifest().map((s) => demoRouteFor(s.page)))];
    for (const route of pages) {
      const rel = route === '/demo' ? 'src/app/demo/page.tsx' : `src/app${route}/page.tsx`;
      expect(existsSync(join(process.cwd(), rel)), `${route} -> ${rel}`).toBe(true);
    }
    // /demo and /demo/* must stay public or the tour redirects to login mid-run.
    expect(read('src/middleware.ts')).toMatch(/'\/demo'/);
  });
});

describe('the demo manifest shape', () => {
  const manifest = buildDemoManifest();

  it('never routes to the workspace dashboard — the demo has none', () => {
    expect(manifest.some((s) => s.page === 'dashboard')).toBe(false);
  });

  it('opens on a centered welcome and closes on the clickable sign-up step', () => {
    expect(manifest[0]).toMatchObject({ id: 'welcome', page: 'today' });
    expect(manifest[0].target, 'the opener is a centered modal, not a spotlight').toBeUndefined();
    const last = manifest[manifest.length - 1];
    expect(last).toMatchObject({
      id: 'demo-signup',
      page: 'today',
      target: '[data-tour="demo-signup"]',
      // Interaction is disabled tour-wide; without this the finale spotlights a
      // CTA the visitor physically cannot click, which is the whole point of it.
      allowInteraction: true,
    });
    expect(read('src/app/demo/chrome.tsx')).toMatch(/href="\/login"\s*\n\s*data-tour="demo-signup"/);
  });

  it('reuses the app tour copy — only the finale is demo-specific', () => {
    const appKeys = new Set(buildManifest({ hasProjects: true }).flatMap((s) => [s.titleKey, s.descKey]));
    const demoOnly = manifest
      .flatMap((s) => [s.titleKey, s.descKey])
      .filter((k) => !appKeys.has(k));
    expect([...new Set(demoOnly)].sort()).toEqual(['tour.demo.finish.desc', 'tour.demo.finish.title']);
  });

  it('carries the finale copy in both catalogs', () => {
    for (const f of ['src/lib/i18n/messages/en.ts', 'src/lib/i18n/messages/it.ts']) {
      expect(read(f), f).toMatch(/'tour\.demo\.finish\.title':/);
      expect(read(f), f).toMatch(/'tour\.demo\.finish\.desc':/);
    }
  });

  it('routes each mode to its own shell', () => {
    expect(routeForMode('demo', 'knowledge', null)).toBe('/demo/knowledge');
    expect(routeForMode('demo', 'actions', null)).toBe('/demo/inbox');
    expect(routeForMode('demo', 'today', null)).toBe('/demo');
    expect(routeForMode('app', 'knowledge', 'proj_1')).toBe('/project/proj_1/knowledge');
    // A demo route never depends on a project id — there is no project.
    expect(routeForMode('demo', 'financial', 'proj_1')).toBe('/demo/financial');
  });
});

describe('the demo run never touches the account', () => {
  const controller = read('src/components/onboarding/TourController.tsx');

  it('the demo path is admitted by the route gate', () => {
    expect(controller).toMatch(/const isDemo = pathname === '\/demo' \|\| pathname\.startsWith\('\/demo\/'\)/);
    expect(controller).toMatch(/if \(!isDemo && pathname !== '\/' && !pathname\.startsWith\('\/project\/'\)\) return;/);
  });

  it('finishing the demo writes a local flag instead of PATCHing preferences', () => {
    // /demo is public: a preferences PATCH would 401, and there is no user row
    // to mark onboarded anyway.
    expect(controller).toMatch(/if \(isDemo\) \{\s*\n\s*markDemoTourSeen\(\);/);
    expect(controller).toMatch(/isDemo[\s\S]{0,120}markDemoTourSeen[\s\S]{0,200}api\.patch\('\/api\/user\/preferences'/);
  });

  it('the demo auto-start makes no network call at all', () => {
    // The app's auto-start reads /api/user/preferences first; the demo branch
    // must gate on hasSeenDemoTour() only.
    expect(controller).toMatch(
      /isDemo && pathname === '\/demo'[\s\S]{0,160}!hasSeenDemoTour\(\)[\s\S]{0,320}writeTourState\(fresh\)/,
    );
    const demoBranch = controller.slice(
      controller.indexOf("} else if (isDemo && pathname === '/demo'"),
      controller.indexOf("} else if (!isDemo && pathname === '/'"),
    );
    expect(demoBranch).not.toMatch(/api\.(get|patch)/);
  });

  it('the project lookup is skipped on the demo', () => {
    expect(controller).toMatch(/if \(!isDemo && state\.stepIndex === 0 && pid === null && pathname === '\/'\)/);
  });

  it('finishing or dismissing the demo actually ends the run', () => {
    // The bug this pins (found live 2026-09-02): driver.js 1.4.0's public
    // destroy() skips the onDestroyStarted branch and only calls onDestroyed
    // while its internal __activeElement/__activeStep survive — which they do
    // not. Both endings were therefore silent: the demo re-offered its tour on
    // every single page load and never wrote lp_demo_tour_seen.
    const ctrl = read('src/components/onboarding/TourController.tsx');
    expect(ctrl).toMatch(/let ended = false;/);
    expect(ctrl).toMatch(/if \(ended\) return;\s*\n\s*ended = true;/);
    expect(ctrl).toMatch(/onDestroyStarted: \(\) => \{/);
    // The seen flag is what stops the re-offer, and only markDone writes it.
    expect(ctrl).toMatch(/markDemoTourSeen\(\)/);
  });

  it('a run is only resumed by the shell that started it', () => {
    expect(controller).toMatch(/if \(state && state\.mode !== mode\) return;/);
  });

  it('the demo popovers are pinned to Italian, matching the Italian-only demo shell', () => {
    expect(controller).toMatch(/const tr = isDemo \? \(key: MessageKey\) => translate\('it', key\) : t;/);
    // No t() may survive in the driver config — it would render the app locale.
    expect(controller).toMatch(/title: tr\(s\.titleKey\)/);
    expect(controller).toMatch(/description: tr\(s\.descKey\)/);
    expect(controller).not.toMatch(/nextBtnText: t\(/);
  });
});

describe('tour state carries its mode', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    const storage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    };
    Object.assign(globalThis, {
      window: { location: { pathname: '/demo' }, dispatchEvent: () => true },
      sessionStorage: storage,
      localStorage: storage,
      Event: class {
        constructor(public type: string) {}
      },
    });
  });

  afterEach(() => {
    for (const k of ['window', 'sessionStorage', 'localStorage', 'Event']) {
      delete (globalThis as Record<string, unknown>)[k];
    }
  });

  it('state written before the demo tour shipped reads back as an app run', async () => {
    const { readTourState } = await import('./tour-state');
    store['lp_tour_state'] = JSON.stringify({ stepIndex: 3, projectId: 'proj_1' });
    expect(readTourState()).toEqual({ stepIndex: 3, projectId: 'proj_1', mode: 'app' });
  });

  it('an explicit demo replay starts a demo run and ignores the seen flag', async () => {
    const { relaunchDemoTour, markDemoTourSeen, hasSeenDemoTour, readTourState } = await import('./tour-state');
    markDemoTourSeen();
    expect(hasSeenDemoTour()).toBe(true);
    relaunchDemoTour();
    expect(readTourState()).toEqual({ stepIndex: 0, projectId: null, mode: 'demo' });
    // Replay must survive the seen flag — it only gates the automatic offer.
    expect(hasSeenDemoTour()).toBe(true);
  });

  it('the seen flag is durable (localStorage), not per-session', () => {
    expect(read('src/components/onboarding/tour-state.ts')).toMatch(/localStorage\.setItem\(DEMO_SEEN_KEY/);
  });
});
