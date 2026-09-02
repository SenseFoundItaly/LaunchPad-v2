/**
 * Declarative step manifest for the cross-page onboarding walkthrough
 * (TourController.tsx). Pure data — no driver.js, no React — so the manifest
 * is trivially testable and the controller stays a thin state machine.
 *
 * Targets are `data-tour` attributes (never CSS structure), following the
 * existing data-artifact-id / data-canvas-section convention. Each page's
 * contiguous run of steps is a "chapter"; the controller navigates between
 * chapters and drives one driver.js instance per page.
 */

import type { MessageKey } from '@/lib/i18n/messages';

export type TourPage = 'dashboard' | 'today' | 'actions' | 'knowledge' | 'financial' | 'chat';

export interface TourStep {
  id: string;
  page: TourPage;
  /** CSS selector for the spotlight target; omit for a centered modal step. */
  target?: string;
  titleKey: MessageKey;
  descKey: MessageKey;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /**
   * Optional steps skip silently when the target hasn't appeared within the
   * wait budget (async/empty surfaces: empty Intel list, empty graph…).
   * Non-optional steps still render — driver.js falls back to a centered
   * popover when the element is missing.
   */
  optional?: boolean;
  /**
   * Let the founder actually CLICK the highlighted element. Interaction is
   * disabled tour-wide (a mid-tour click on a highlighted link desyncs route
   * vs step), but a step whose entire instruction is "press this" must not
   * spotlight a button the overlay makes unclickable.
   */
  allowInteraction?: boolean;
}

/**
 * Which shell the walkthrough is running in. 'app' is the authenticated
 * product; 'demo' is the public /demo replica, which has no account, no
 * project id and no workspace dashboard.
 */
export type TourMode = 'app' | 'demo';

/**
 * /demo mirrors the project shell one-for-one, so the manifest's page names
 * map onto fixed public routes. There is no workspace dashboard in the demo —
 * `dashboard` collapses onto demo Home so a stale index can never route
 * nowhere, and buildDemoManifest() simply never emits a dashboard step.
 */
const DEMO_ROUTES: Record<TourPage, string> = {
  dashboard: '/demo',
  today: '/demo',
  knowledge: '/demo/knowledge',
  chat: '/demo/chat',
  actions: '/demo/inbox',
  financial: '/demo/financial',
};

export function demoRouteFor(page: TourPage): string {
  return DEMO_ROUTES[page];
}

/** Route for a step under either shell — the controller's single call site. */
export function routeForMode(mode: TourMode, page: TourPage, projectId: string | null): string {
  return mode === 'demo' ? demoRouteFor(page) : routeFor(page, projectId);
}

export function routeFor(page: TourPage, projectId: string | null): string {
  if (page === 'dashboard' || !projectId) return '/';
  return `/project/${projectId}/${page}`;
}

const nav = (page: Exclude<TourPage, 'dashboard'>, id: string, titleKey: MessageKey, descKey: MessageKey): TourStep => ({
  id: `nav-${id}`,
  page,
  target: `[data-tour="nav-${id}"]`,
  titleKey,
  descKey,
  side: 'right',
  align: 'start',
});

/**
 * The full walkthrough: dashboard → into the first project → each NavRail
 * section in order. `hasProjects: false` swaps everything after the welcome
 * for a single "create your first project" finale — no pause-and-wait
 * machinery; Settings → "Replay tour" covers the comeback path.
 */
export function buildManifest({ hasProjects }: { hasProjects: boolean }): TourStep[] {
  if (!hasProjects) {
    return [
      { id: 'welcome', page: 'dashboard', titleKey: 'tour.welcome.title', descKey: 'tour.welcome.desc' },
      // allowInteraction: this step's whole point is "press New project" — with
      // the tour-wide overlay it spotlit a button the founder couldn't click.
      { id: 'create-empty', page: 'dashboard', target: '[data-tour="new-project"]', titleKey: 'tour.dash.empty.title', descKey: 'tour.dash.empty.desc', side: 'right', align: 'center', allowInteraction: true },
    ];
  }
  // Changelog 28/08 order: start on project Home (backdrop) with the NavRail
  // lit, then walk the rail — Knowledge → Co-Pilot → Watchers → Finance —
  // return to Home for its widgets (score, IRL, journey, watcher glance), and
  // finish on the workspace dashboard (projects grid, New project, signals).
  return [
    // ── Chapter: project Home as backdrop (/today) ──────────────────────────
    { id: 'welcome', page: 'today', titleKey: 'tour.welcome.title', descKey: 'tour.welcome.desc' },
    { id: 'nav-rail', page: 'today', target: '[data-tour="nav-rail"]', titleKey: 'tour.rail.title', descKey: 'tour.rail.desc', side: 'right', align: 'start' },
    // ── Chapter: Knowledge graph (/knowledge) ───────────────────────────────
    nav('knowledge', 'knowledge', 'tour.knowledge.title', 'tour.knowledge.desc'),
    { id: 'knowledge-graph', page: 'knowledge', target: '[data-tour="knowledge-graph"]', titleKey: 'tour.knowledge.graph.title', descKey: 'tour.knowledge.graph.desc', optional: true },
    { id: 'add-documents', page: 'knowledge', target: '[data-tour="add-documents"]', titleKey: 'tour.knowledge.add.title', descKey: 'tour.knowledge.add.desc', side: 'bottom', align: 'end', optional: true },
    // ── Chapter: Co-pilot (/chat) ───────────────────────────────────────────
    nav('chat', 'chat', 'tour.copilot.title', 'tour.copilot.desc'),
    { id: 'chat-composer', page: 'chat', target: '[data-tour="chat-composer"]', titleKey: 'tour.chat.composer.title', descKey: 'tour.chat.composer.desc', side: 'top', align: 'start', optional: true },
    { id: 'chat-canvas', page: 'chat', target: '[data-tour="chat-canvas"]', titleKey: 'tour.chat.canvas.title', descKey: 'tour.chat.canvas.desc', side: 'left', align: 'center', optional: true },
    // ── Chapter: Watchers (/actions) ────────────────────────────────────────
    nav('actions', 'inbox', 'tour.watchers.title', 'tour.watchers.desc'),
    { id: 'inbox-tabs', page: 'actions', target: '[data-tour="inbox-tabs"]', titleKey: 'tour.actions.tabs.title', descKey: 'tour.actions.tabs.desc', side: 'bottom', align: 'start', optional: true },
    // Watchers is the default landing tab (Intel retired, PR #202) — highlight
    // the sensor list, not the needs-review queue that only shows on deep link.
    { id: 'watchers-list', page: 'actions', target: '[data-tour="watchers-list"]', titleKey: 'tour.actions.list.title', descKey: 'tour.actions.list.desc', optional: true },
    // ── Chapter: Financials (/financial) ────────────────────────────────────
    nav('financial', 'financial', 'tour.financial.title', 'tour.financial.desc'),
    { id: 'financial-model', page: 'financial', target: '[data-tour="financial-model"]', titleKey: 'tour.financial.model.title', descKey: 'tour.financial.model.desc', optional: true },
    // ── Chapter: project Home widgets (/today, second visit) ────────────────
    nav('today', 'dashboard', 'tour.home.title', 'tour.home.desc'),
    { id: 'score-panel', page: 'today', target: '[data-tour="score-panel"]', titleKey: 'tour.today.score.title', descKey: 'tour.today.score.desc', side: 'bottom', align: 'start', optional: true },
    { id: 'irl-panel', page: 'today', target: '[data-tour="irl-panel"]', titleKey: 'tour.today.irl.title', descKey: 'tour.today.irl.desc', side: 'bottom', align: 'start', optional: true },
    { id: 'stage-card', page: 'today', target: '[data-tour="stage-card"]', titleKey: 'tour.today.stage.title', descKey: 'tour.today.stage.desc', side: 'right', align: 'start', optional: true },
    { id: 'watchers-panel', page: 'today', target: '[data-tour="watchers-panel"]', titleKey: 'tour.today.watchers.title', descKey: 'tour.today.watchers.desc', side: 'left', align: 'start', optional: true },
    // ── Chapter: workspace dashboard (/) ────────────────────────────────────
    { id: 'projects-rail', page: 'dashboard', target: '[data-tour="projects-grid"]', titleKey: 'tour.dash.projects.title', descKey: 'tour.dash.projects.desc', side: 'bottom', align: 'start' },
    { id: 'new-project', page: 'dashboard', target: '[data-tour="new-project"]', titleKey: 'tour.dash.create.title', descKey: 'tour.dash.create.desc', side: 'bottom', align: 'end' },
    { id: 'dash-signals', page: 'dashboard', target: '[data-tour="dash-signals"]', titleKey: 'tour.dash.signals.title', descKey: 'tour.dash.signals.desc', side: 'bottom', align: 'end' },
    { id: 'finish', page: 'dashboard', titleKey: 'tour.finish.title', descKey: 'tour.finish.desc' },
  ];
}

/**
 * The public /demo walkthrough. Same chapters and the same copy as the signed-in
 * tour, with three differences forced by the demo itself:
 *   - no workspace dashboard chapter (the demo has one project and no grid), so
 *     it closes on a sign-up step instead of `finish`;
 *   - the rail's Home entry is `nav-home`, not `nav-dashboard`;
 *   - the demo Co-pilot is a static transcript with no composer, so the
 *     composer step points at the conversation column (its copy — "describe
 *     your idea and the Co-pilot builds your canvas" — reads correctly there).
 * Everything is optional except the openers: the demo is static, but a step
 * whose target moved should skip, never wedge the run.
 */
export function buildDemoManifest(): TourStep[] {
  return [
    // ── Chapter: demo Home as backdrop (/demo) ──────────────────────────────
    { id: 'welcome', page: 'today', titleKey: 'tour.welcome.title', descKey: 'tour.welcome.desc' },
    { id: 'nav-rail', page: 'today', target: '[data-tour="nav-rail"]', titleKey: 'tour.rail.title', descKey: 'tour.rail.desc', side: 'right', align: 'start' },
    // ── Chapter: Knowledge (/demo/knowledge) ────────────────────────────────
    nav('knowledge', 'knowledge', 'tour.knowledge.title', 'tour.knowledge.desc'),
    { id: 'knowledge-graph', page: 'knowledge', target: '[data-tour="knowledge-graph"]', titleKey: 'tour.knowledge.graph.title', descKey: 'tour.knowledge.graph.desc', optional: true },
    // ── Chapter: Co-pilot (/demo/chat) ──────────────────────────────────────
    nav('chat', 'chat', 'tour.copilot.title', 'tour.copilot.desc'),
    { id: 'chat-transcript', page: 'chat', target: '[data-tour="chat-transcript"]', titleKey: 'tour.chat.composer.title', descKey: 'tour.chat.composer.desc', side: 'right', align: 'center', optional: true },
    { id: 'chat-canvas', page: 'chat', target: '[data-tour="chat-canvas"]', titleKey: 'tour.chat.canvas.title', descKey: 'tour.chat.canvas.desc', side: 'left', align: 'center', optional: true },
    // ── Chapter: Watchers (/demo/inbox) ─────────────────────────────────────
    nav('actions', 'inbox', 'tour.watchers.title', 'tour.watchers.desc'),
    { id: 'inbox-tabs', page: 'actions', target: '[data-tour="inbox-tabs"]', titleKey: 'tour.actions.tabs.title', descKey: 'tour.actions.tabs.desc', side: 'bottom', align: 'start', optional: true },
    { id: 'watchers-list', page: 'actions', target: '[data-tour="watchers-list"]', titleKey: 'tour.actions.list.title', descKey: 'tour.actions.list.desc', optional: true },
    // ── Chapter: Finance (/demo/financial) ──────────────────────────────────
    nav('financial', 'financial', 'tour.financial.title', 'tour.financial.desc'),
    { id: 'financial-model', page: 'financial', target: '[data-tour="financial-model"]', titleKey: 'tour.financial.model.title', descKey: 'tour.financial.model.desc', optional: true },
    // ── Chapter: back to demo Home for its widgets (/demo) ──────────────────
    nav('today', 'home', 'tour.home.title', 'tour.home.desc'),
    { id: 'score-panel', page: 'today', target: '[data-tour="score-panel"]', titleKey: 'tour.today.score.title', descKey: 'tour.today.score.desc', side: 'bottom', align: 'start', optional: true },
    { id: 'stage-card', page: 'today', target: '[data-tour="stage-card"]', titleKey: 'tour.today.stage.title', descKey: 'tour.today.stage.desc', side: 'right', align: 'start', optional: true },
    { id: 'watchers-panel', page: 'today', target: '[data-tour="watchers-panel"]', titleKey: 'tour.today.watchers.title', descKey: 'tour.today.watchers.desc', side: 'left', align: 'start', optional: true },
    // ── Finale: the whole point of a public demo — allowInteraction so the
    //    spotlit CTA is actually clickable through the overlay.
    { id: 'demo-signup', page: 'today', target: '[data-tour="demo-signup"]', titleKey: 'tour.demo.finish.title', descKey: 'tour.demo.finish.desc', side: 'bottom', align: 'end', allowInteraction: true },
  ];
}
