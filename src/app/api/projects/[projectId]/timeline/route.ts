import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { listWatchers, watcherTopicCounts, type Watcher, type WatcherTopic } from '@/lib/watchers';

/**
 * The unified Signals page payload.
 *
 * One round-trip. Replaces the old four-fetch dance
 *   (/signals + /watch-sources + /intelligence-briefs + /competitors).
 *
 * Shape favors the redesigned IA:
 *   - briefs:   synthesis layer surfaces at the top of the page
 *   - findings: raw signals grouped by watcher_id underneath
 *   - watchers: right-rail list (with recent_finding_count badges)
 *   - topic_counts: drives any topic-level grouping
 *
 * Every finding/brief carries depth-of-evidence fields the old API hid
 *   (evidence_count, sources_consulted, confidence). UI surfaces them as
 *   chips so the founder can tell synthesis from a stub headline.
 */

interface TimelineBrief {
  id: string;
  kind: 'brief';
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  entity_name: string | null;
  confidence: number;
  evidence_count: number;          // # of signals folded into this brief
  sources_consulted: number;       // # distinct URLs across those signals
  recommended_actions: unknown[];
  signal_ids: string[];
  status: string;
  created_at: string;
}

interface TimelineFinding {
  id: string;
  kind: 'finding' | 'change';
  watcher_id: string | null;       // id from the unified Watcher (w_m_* / w_s_*)
  watcher_name: string | null;
  topic: WatcherTopic | null;
  headline: string;
  body: string | null;
  source_url: string | null;
  confidence: number | null;
  relevance_score: number | null;
  evidence_count: number;          // 1 for raw findings, used for consistency
  brief_id: string | null;         // set if this finding fed a brief
  reviewed_state: string | null;
  created_at: string;
}

interface BriefRowRaw {
  id: string;
  brief_type: string;
  entity_name: string | null;
  title: string;
  narrative: string;
  temporal_prediction: string | null;
  confidence: number;
  signal_ids: string[] | string;
  signal_count: number;
  recommended_actions: unknown[] | string;
  status: string;
  created_at: string;
  sources_consulted: string | number;
}

interface AlertRowRaw {
  id: string;
  monitor_id: string | null;
  alert_type: string;
  headline: string;
  body: string | null;
  source_url: string | null;
  relevance_score: number;
  confidence: number;
  reviewed_state: string;
  created_at: string;
}

interface ChangeRowRaw {
  id: string;
  watch_source_id: string;
  diff_summary: string | null;
  significance: string;
  significance_rationale: string | null;
  source_url: string;
  source_label: string;
  detected_at: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, parseInt(url.searchParams.get('days') || '14', 10)));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const searchRaw = url.searchParams.get('q')?.trim().toLowerCase() || '';

  // -------------------------------------------------------------------------
  // Watchers (right-rail + topic grouping) + cold-start context check.
  // The context flag drives the Today page's "tell me about you" card: when
  // every source the proposer reads from (idea_canvas / research / graph_nodes)
  // is empty, the proposer can only return [], so Today should ask for context
  // up front instead of showing an empty Briefs panel.
  // -------------------------------------------------------------------------
  const [watchers, topicCounts, contextCheck] = await Promise.all([
    listWatchers(projectId),
    watcherTopicCounts(projectId),
    checkContextComplete(projectId),
  ]);

  // Maps from origin_id to watcher meta so findings can be tagged.
  const monitorIdToWatcher = new Map<string, Watcher>();
  const watchSourceIdToWatcher = new Map<string, Watcher>();
  for (const w of watchers) {
    if (w._origin === 'monitor') monitorIdToWatcher.set(w._origin_id, w);
    else watchSourceIdToWatcher.set(w._origin_id, w);
  }

  // -------------------------------------------------------------------------
  // Briefs (top of page) — only active, with derived sources_consulted
  // -------------------------------------------------------------------------
  const briefRows = await query<BriefRowRaw>(
    `SELECT ib.id, ib.brief_type, ib.entity_name, ib.title, ib.narrative,
            ib.temporal_prediction, ib.confidence, ib.signal_ids, ib.signal_count,
            ib.recommended_actions, ib.status, ib.created_at,
            -- distinct source URLs across the alerts cited by this brief.
            -- Use jsonb_exists() instead of the jsonb-membership operator
            -- because the project convertPlaceholders helper greedily
            -- rewrites every question mark outside string literals into a
            -- SQL parameter, which corrupts the operator.
            COALESCE((
              SELECT COUNT(DISTINCT ea.source_url)
              FROM ecosystem_alerts ea
              WHERE ea.project_id = ib.project_id
                AND ea.source_url IS NOT NULL
                AND jsonb_exists(ib.signal_ids::jsonb, ea.id)
            ), 0) AS sources_consulted
       FROM intelligence_briefs ib
      WHERE ib.project_id = ?
        AND ib.status = 'active'
        AND ib.created_at >= ?
      ORDER BY ib.created_at DESC
      LIMIT 10`,
    projectId, cutoff,
  );

  const briefs: TimelineBrief[] = briefRows.map((b) => {
    const signal_ids = parseJsonArray<string>(b.signal_ids);
    const recommended_actions = parseJsonArray<unknown>(b.recommended_actions);
    return {
      id: b.id,
      kind: 'brief',
      title: b.title,
      narrative: b.narrative,
      temporal_prediction: b.temporal_prediction,
      entity_name: b.entity_name,
      confidence: b.confidence,
      evidence_count: b.signal_count || signal_ids.length,
      sources_consulted: Number(b.sources_consulted) || 0,
      recommended_actions,
      signal_ids,
      status: b.status,
      created_at: b.created_at,
    };
  });

  // Build a reverse index: signal_id → brief_id (for finding.brief_id).
  const signalToBrief = new Map<string, string>();
  for (const b of briefs) {
    for (const sid of b.signal_ids) signalToBrief.set(sid, b.id);
  }

  // -------------------------------------------------------------------------
  // Findings: ecosystem_alerts + source_changes
  // -------------------------------------------------------------------------
  const [alerts, changes] = await Promise.all([
    query<AlertRowRaw>(
      `SELECT id, monitor_id, alert_type, headline, body, source_url,
              relevance_score, confidence, reviewed_state, created_at
         FROM ecosystem_alerts
        WHERE project_id = ?
          AND created_at >= ?
          AND reviewed_state != 'dismissed'
        ORDER BY created_at DESC
        LIMIT 100`,
      projectId, cutoff,
    ),
    query<ChangeRowRaw>(
      `SELECT sc.id, sc.watch_source_id, sc.diff_summary, sc.significance,
              sc.significance_rationale, ws.url AS source_url, ws.label AS source_label,
              sc.detected_at
         FROM source_changes sc
         JOIN watch_sources ws ON ws.id = sc.watch_source_id
        WHERE sc.project_id = ?
          AND sc.detected_at >= ?
          AND sc.change_status != 'same'
          AND sc.significance != 'noise'
        ORDER BY sc.detected_at DESC
        LIMIT 100`,
      projectId, cutoff,
    ),
  ]);

  const alertFindings: TimelineFinding[] = alerts.map((a) => {
    const watcher = a.monitor_id ? monitorIdToWatcher.get(a.monitor_id) : null;
    return {
      id: a.id,
      kind: 'finding',
      watcher_id: watcher?.id || null,
      watcher_name: watcher?.name || null,
      topic: watcher?.topic || null,
      headline: a.headline,
      body: a.body,
      source_url: a.source_url,
      confidence: a.confidence,
      relevance_score: a.relevance_score,
      evidence_count: 1,
      brief_id: signalToBrief.get(a.id) || null,
      reviewed_state: a.reviewed_state,
      created_at: a.created_at,
    };
  });

  const changeFindings: TimelineFinding[] = changes.map((c) => {
    const watcher = watchSourceIdToWatcher.get(c.watch_source_id);
    return {
      id: c.id,
      kind: 'change',
      watcher_id: watcher?.id || null,
      watcher_name: watcher?.name || c.source_label,
      topic: watcher?.topic || null,
      headline: c.diff_summary || `Change detected on ${c.source_label}`,
      body: c.significance_rationale,
      source_url: c.source_url,
      confidence: null,
      relevance_score: significanceToScore(c.significance),
      evidence_count: 1,
      brief_id: signalToBrief.get(c.id) || null,
      reviewed_state: null,
      created_at: c.detected_at,
    };
  });

  let findings = [...alertFindings, ...changeFindings].sort((a, b) =>
    // postgres.js returns timestamps as Date objects, not strings — compare
    // epoch ms so this works for both Date and ISO-string inputs.
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  // Single search filter — replaces the old 6-filter UI.
  if (searchRaw) {
    findings = findings.filter((f) => {
      const hay = `${f.headline} ${f.body || ''} ${f.watcher_name || ''}`.toLowerCase();
      return hay.includes(searchRaw);
    });
  }

  return json({
    briefs,
    findings,
    watchers,
    topic_counts: topicCounts,
    window_days: days,
    context: contextCheck,
  });
}

// ---------------------------------------------------------------------------
// checkContextComplete — mirrors the proposer's hasContext gate so the UI can
// show the same answer the proposer would compute. Single query, no joins.
// ---------------------------------------------------------------------------

async function checkContextComplete(projectId: string): Promise<{
  has_idea: boolean;
  has_competitors: boolean;
  has_keywords: boolean;
  complete: boolean;
}> {
  const [ideaRows, researchRows, keywordRows] = await Promise.all([
    query<{ problem: string | null; solution: string | null }>(
      'SELECT problem, solution FROM idea_canvas WHERE project_id = ?',
      projectId,
    ),
    query<{ competitors: string | null }>(
      'SELECT competitors FROM research WHERE project_id = ?',
      projectId,
    ),
    query<{ n: string | number }>(
      `SELECT COUNT(*) AS n FROM graph_nodes
        WHERE project_id = ?
          AND node_type IN ('market_segment', 'technology', 'trend')`,
      projectId,
    ),
  ]);
  const idea = ideaRows[0];
  const has_idea = !!(idea?.problem?.trim() || idea?.solution?.trim());
  let has_competitors = false;
  if (researchRows[0]?.competitors) {
    try {
      const parsed = JSON.parse(researchRows[0].competitors);
      has_competitors = Array.isArray(parsed) && parsed.length > 0;
    } catch { /* malformed JSON — treat as absent */ }
  }
  const has_keywords = Number(keywordRows[0]?.n ?? 0) > 0;
  return {
    has_idea,
    has_competitors,
    has_keywords,
    complete: has_idea || has_competitors || has_keywords,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function significanceToScore(sig: string): number {
  switch (sig) {
    case 'high': return 0.9;
    case 'medium': return 0.7;
    case 'low': return 0.4;
    default: return 0.2;
  }
}
