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
      { id: 'create-empty', page: 'dashboard', target: '[data-tour="new-project"]', titleKey: 'tour.dash.empty.title', descKey: 'tour.dash.empty.desc', side: 'right', align: 'center' },
    ];
  }
  return [
    // ── Chapter: workspace dashboard (/) ────────────────────────────────────
    { id: 'welcome', page: 'dashboard', titleKey: 'tour.welcome.title', descKey: 'tour.welcome.desc' },
    // The left projects rail was retired (2026-07-21 — it duplicated the main
    // grid); the step now points at the grid itself, and New project moved to
    // the workspace header, top right.
    { id: 'projects-rail', page: 'dashboard', target: '[data-tour="projects-grid"]', titleKey: 'tour.dash.projects.title', descKey: 'tour.dash.projects.desc', side: 'bottom', align: 'start' },
    { id: 'new-project', page: 'dashboard', target: '[data-tour="new-project"]', titleKey: 'tour.dash.create.title', descKey: 'tour.dash.create.desc', side: 'bottom', align: 'end' },
    { id: 'dash-signals', page: 'dashboard', target: '[data-tour="dash-signals"]', titleKey: 'tour.dash.signals.title', descKey: 'tour.dash.signals.desc', side: 'bottom', align: 'end' },
    // ── Chapter: project Home (/today) ──────────────────────────────────────
    nav('today', 'dashboard', 'tour.home.title', 'tour.home.desc'),
    { id: 'score-panel', page: 'today', target: '[data-tour="score-panel"]', titleKey: 'tour.today.score.title', descKey: 'tour.today.score.desc', side: 'bottom', align: 'start', optional: true },
    { id: 'stage-card', page: 'today', target: '[data-tour="stage-card"]', titleKey: 'tour.today.stage.title', descKey: 'tour.today.stage.desc', side: 'right', align: 'start', optional: true },
    { id: 'watchers-panel', page: 'today', target: '[data-tour="watchers-panel"]', titleKey: 'tour.today.watchers.title', descKey: 'tour.today.watchers.desc', side: 'left', align: 'start', optional: true },
    // ── Chapter: Watchers (/actions) ────────────────────────────────────────
    nav('actions', 'inbox', 'tour.watchers.title', 'tour.watchers.desc'),
    { id: 'inbox-tabs', page: 'actions', target: '[data-tour="inbox-tabs"]', titleKey: 'tour.actions.tabs.title', descKey: 'tour.actions.tabs.desc', side: 'bottom', align: 'start', optional: true },
    // Watchers is the default landing tab (Intel retired, PR #202) — highlight
    // the sensor list, not the needs-review queue that only shows on deep link.
    { id: 'watchers-list', page: 'actions', target: '[data-tour="watchers-list"]', titleKey: 'tour.actions.list.title', descKey: 'tour.actions.list.desc', optional: true },
    // ── Chapter: Knowledge graph (/knowledge) ───────────────────────────────
    nav('knowledge', 'knowledge', 'tour.knowledge.title', 'tour.knowledge.desc'),
    { id: 'knowledge-graph', page: 'knowledge', target: '[data-tour="knowledge-graph"]', titleKey: 'tour.knowledge.graph.title', descKey: 'tour.knowledge.graph.desc', optional: true },
    { id: 'add-documents', page: 'knowledge', target: '[data-tour="add-documents"]', titleKey: 'tour.knowledge.add.title', descKey: 'tour.knowledge.add.desc', side: 'bottom', align: 'end', optional: true },
    // ── Chapter: Financials (/financial) ────────────────────────────────────
    nav('financial', 'financial', 'tour.financial.title', 'tour.financial.desc'),
    { id: 'financial-model', page: 'financial', target: '[data-tour="financial-model"]', titleKey: 'tour.financial.model.title', descKey: 'tour.financial.model.desc', optional: true },
    // ── Chapter: Co-pilot (/chat) ───────────────────────────────────────────
    nav('chat', 'chat', 'tour.copilot.title', 'tour.copilot.desc'),
    { id: 'chat-composer', page: 'chat', target: '[data-tour="chat-composer"]', titleKey: 'tour.chat.composer.title', descKey: 'tour.chat.composer.desc', side: 'top', align: 'start', optional: true },
    { id: 'chat-canvas', page: 'chat', target: '[data-tour="chat-canvas"]', titleKey: 'tour.chat.canvas.title', descKey: 'tour.chat.canvas.desc', side: 'left', align: 'center', optional: true },
    { id: 'finish', page: 'chat', titleKey: 'tour.finish.title', descKey: 'tour.finish.desc' },
  ];
}
