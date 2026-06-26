/**
 * Bridge between the legacy lp-*-changed window events and TanStack Query
 * cache invalidation.
 *
 * Each entry maps one event name → the list of query-key TOPICS that should
 * be invalidated when that event fires. A topic is the FIRST segment of a
 * queryKey array — e.g. ['knowledge', projectId, 'graph'] has topic
 * 'knowledge'. Invalidation is prefix-based, so naming a topic flushes
 * every query under it.
 *
 * Only list topics that have at least one queryKey consumer — dead topics
 * cause confusing "should have invalidated" mysteries when the missing
 * consumer is added later. Add the topic when you add the query.
 *
 * Current consumers:
 *   'knowledge' → ['knowledge', projectId, 'graph']      (useKnowledgeGraph, knowledge/page.tsx)
 *                 ['knowledge', projectId, 'facts']       (KnowledgeReviewList)
 *   'actions'   → ['actions', projectId, 'count']   (useOpenActionCount, NavRail badge)
 *                 ['actions', projectId, 'inbox']   (actions/page.tsx)
 *                 ['actions', projectId, 'preview', 3] (today/page.tsx panel)
 *   'timeline'  → ['timeline', projectId, 7]        (today/page.tsx briefs panel)
 *                 ['timeline', projectId, 14, q]    (signals/page.tsx)
 *   'credits'   → ['credits', projectId]            (CreditsBadge, usage/page.tsx)
 *   'usage'     → ['usage', projectId]              (usage/page.tsx)
 *   'stages'    → ['stages', projectId]             (SpineSection)
 *   'idea-canvas' → ['idea-canvas', projectId]      (IdeaCanvasHeader)
 *   'briefs'    → ['briefs', projectId]             (useIntelligenceBriefs / Canvas)
 *   'skills'    → ['skills', projectId, 'gated']    (useGatedSkills / Co-pilot)
 *   'financial' → ['financial', projectId]          (FinancialModelPanel)
 */
export const EVENT_TO_TOPICS: Record<string, string[]> = {
  // Knowledge graph nodes/edges. Fired by KnowledgeReviewList apply/reject
  // (components/knowledge/KnowledgeReviewList.tsx:297). Uploads go through
  // qc.invalidateQueries directly inside knowledge/page.tsx, not this event.
  'lp-knowledge-changed': ['knowledge'],

  // pending_actions table + signal timeline (briefs panel reads timeline,
  // which surfaces signals that become actions) + credits (chat charges
  // credits on every action). Fired by chat after proposing/applying
  // actions (chat/page.tsx:283, :471, :504, :560).
  //
  // Canvas topics added 2026-06: chat agent now has write tools for
  // pricing_state, idea_canvas, memory_facts. Any chat turn might have
  // mutated these, so we flush downstream consumers (StageCard on Home,
  // open facet tabs in Co-pilot Canvas, project summary). React-query
  // ignores no-op invalidations cheaply so the over-fetch tax is small.
  'lp-actions-changed': [
    'actions',
    'timeline',
    'credits',
    'stages',
    'pricing',
    'burn-rate',
    'workflow',
    'metrics',
    'competitors',
    'monitors',
    'loops',
    'fundraising',
    'memory',
    // Section-page satellite fetches migrated onto the cache 2026-06-26. A chat
    // turn can mutate any of these (charges usage, proposes entities, writes
    // idea_canvas / financial model, unlocks gated skills), so flush their
    // queries here instead of each component listening to lp-actions-changed
    // itself (the per-component listeners were removed when they moved to
    // useQuery — the bridge is now the single source of invalidation).
    'knowledge',
    'usage',
    'idea-canvas',
    'briefs',
    'skills',
    'financial',
  ],

  // Workflow/task state. Fired by chat when a workflow-card mutates
  // (chat/page.tsx:559). 'actions' intentionally omitted — chat dispatches
  // lp-actions-changed alongside lp-tasks-changed, so the actions invalidation
  // is already covered by that handler. Listing it twice would double-fetch.
  'lp-tasks-changed': ['tasks', 'workflow'],

  // Credits-specific bumps (e.g. CreditsBadge "+100 free credits"). Dispatched
  // via CustomEvent({ detail: { projectId } }) so the bridge can scope
  // invalidation to one project — bare `new Event(...)` would flush all
  // projects' caches because projectId is undefined in the bridge.
  'lp-credits-changed': ['credits'],
};
