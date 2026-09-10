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
 *   'gate-verdict' → ['gate-verdict', projectId]    (useGateVerdict, SpineSection footer)
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
  // Every topic here MUST be a prefix some useQuery actually uses — a topic
  // nothing reads is an invalidation that silently does nothing, which is how
  // item 9 hid for three months. A test enforces both directions.
  'lp-actions-changed': [
    'actions',
    'credits',
    'stages',
    // The gate verdict moves on the same signals as the stages it closes: a
    // chat turn can stage/record it, and the spine footer dispatches this event
    // after recording or reopening one.
    'gate-verdict',
    // 'watchers' + 'watcher-detail', NOT 'monitors'. The 2026-06-09 unification
    // ("monitors + watch_sources as watchers") renamed the founder-facing query
    // key and this map was not updated, so for three months every
    // lp-actions-changed flushed a prefix only OnboardingCard still reads. The
    // watcher list never refetched: apply a watcher and it stays absent until a
    // manual page reload — changelog 05/09 item 9, "devo refreshare la pagina
    // per vederle attive". 'monitors' is kept because OnboardingCard is a real
    // consumer.
    'watchers',
    'watcher-detail',
    'monitors',
    'loops',
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
    // A chat turn can run a scoring skill or move the IRL, and every one of
    // these renders a number the founder is watching. None was flushed by any
    // event before (same audit): the Home score sat stale until a reload.
    'score',
    'score-history',
    'project-score',
    'irl',
  ],

  // `lp-tasks-changed` was removed 2026-09-10. Its only topic ('tasks') had no
  // consumer and no client reads /tasks, so the event invalidated nothing — and
  // chat dispatched lp-actions-changed on the very next line, which does cover
  // the inbox row. A no-op event is worse than none: it reads like coverage.

  'lp-credits-changed': ['credits'],
};
