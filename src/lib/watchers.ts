/**
 * Watchers — unified read-side facade over `monitors` + `watch_sources`.
 *
 * The founder thinks in one primitive: "a thing you keep checking for me."
 * The DB still has two tables (LLM-scan monitors vs URL-diff watch_sources).
 * This module collapses both into a single `Watcher` shape so the new
 * Signals UI never has to care which table a row came from.
 *
 * Write-side (create/edit/delete) still goes through the legacy endpoints
 * for now — a follow-up PR will migrate writers + collapse to one table.
 */

import { query } from '@/lib/db';

export type WatcherKind = 'scan' | 'diff' | 'hybrid';
export type WatcherDepth = 'pulse' | 'deep';
export type WatcherCadence = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
export type WatcherStatus = 'active' | 'paused' | 'error' | 'archived';

/**
 * Founder-facing topics. Maps both:
 *   - monitor.type ('ecosystem.competitors' → 'competitors')
 *   - watch_source.category ('competitor_pricing' → 'competitors')
 * into one short list. New UI groups by these.
 */
export type WatcherTopic =
  | 'competitors'
  | 'ip'
  | 'trends'
  | 'partnerships'
  | 'hiring'
  | 'sentiment'
  | 'funding'
  | 'regulatory'
  | 'pricing'
  | 'custom';

export interface Watcher {
  id: string;
  project_id: string;
  /** Founder-facing label. */
  name: string;
  /** Bucket — drives icon, sidebar grouping, brief correlation. */
  topic: WatcherTopic;
  /** How the watcher fetches: LLM scan, URL diff, or both. */
  kind: WatcherKind;
  /**
   * Depth of analysis:
   *   - 'pulse' = cheap headline/diff (no synthesis)
   *   - 'deep'  = LLM reasons over result, cites sources, scores relevance
   */
  depth: WatcherDepth;
  cadence: WatcherCadence;
  status: WatcherStatus;
  /** Inputs the watcher consumes — urls for diff, keywords for scan, etc. */
  inputs: {
    urls?: string[];
    keywords?: string[];
    competitor_names?: string[];
  };
  last_run_at: string | null;
  next_run_at: string | null;
  /** Findings in the last 7 days. Drives "X new" badge. */
  recent_finding_count: number;
  created_at: string;
  /** Internal — which table this came from. UI should ignore. */
  _origin: 'monitor' | 'watch_source';
  /** Internal — original row id, for write-path routing. */
  _origin_id: string;
}

// =============================================================================
// Topic mapping — single source of truth for category collapse.
// =============================================================================

const MONITOR_TYPE_TO_TOPIC: Record<string, WatcherTopic> = {
  'ecosystem.competitors': 'competitors',
  'ecosystem.ip': 'ip',
  'ecosystem.trends': 'trends',
  'ecosystem.partnerships': 'partnerships',
  'ecosystem.hiring': 'hiring',
  'ecosystem.customer_sentiment': 'sentiment',
  'ecosystem.social': 'sentiment',
  'ecosystem.ads': 'pricing',
};

const WATCH_SOURCE_CATEGORY_TO_TOPIC: Record<string, WatcherTopic> = {
  competitor_pricing: 'pricing',
  competitor_product: 'competitors',
  patent_database: 'ip',
  regulatory: 'regulatory',
  news: 'trends',
  careers_page: 'hiring',
  social_feed: 'sentiment',
  review_site: 'sentiment',
  ad_tracker: 'pricing',
  marketing: 'competitors',
  custom: 'custom',
};

function topicFromMonitorType(type: string): WatcherTopic {
  return MONITOR_TYPE_TO_TOPIC[type] || 'custom';
}

function topicFromWatchSourceCategory(category: string): WatcherTopic {
  return WATCH_SOURCE_CATEGORY_TO_TOPIC[category] || 'custom';
}

// =============================================================================
// Row shapes (raw from DB)
// =============================================================================

interface MonitorRowRaw {
  id: string;
  project_id: string;
  type: string;
  name: string;
  schedule: string;
  status: string;
  last_run: string | null;
  next_run: string | null;
  urls_to_track: string[] | null;
  config: Record<string, unknown> | null;
  created_at: string;
  recent_finding_count: string | number;
}

interface WatchSourceRowRaw {
  id: string;
  project_id: string;
  url: string;
  label: string;
  category: string;
  schedule: string;
  status: string;
  last_scraped_at: string | null;
  next_scrape_at: string | null;
  monitor_id: string | null;
  created_at: string;
  recent_finding_count: string | number;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch all watchers for a project as one unified list.
 *
 * Excludes:
 *   - Watch sources already attached to a monitor (monitor_id IS NOT NULL) —
 *     they show up under the monitor entry as inputs.urls, not as their own
 *     watcher.
 *   - Archived rows.
 */
export async function listWatchers(projectId: string): Promise<Watcher[]> {
  const [monitors, watchSources] = await Promise.all([
    query<MonitorRowRaw>(
      `SELECT m.id, m.project_id, m.type, m.name, m.schedule, m.status,
              m.last_run, m.next_run, m.urls_to_track, m.config, m.created_at,
              COALESCE((
                SELECT COUNT(*) FROM ecosystem_alerts ea
                WHERE ea.monitor_id = m.id
                  AND ea.created_at > NOW() - INTERVAL '7 days'
              ), 0) AS recent_finding_count
         FROM monitors m
        WHERE m.project_id = ?
          AND m.status != 'archived'
        ORDER BY m.created_at DESC`,
      projectId,
    ),
    query<WatchSourceRowRaw>(
      `SELECT ws.id, ws.project_id, ws.url, ws.label, ws.category, ws.schedule,
              ws.status, ws.last_scraped_at, ws.next_scrape_at, ws.monitor_id,
              ws.created_at,
              COALESCE((
                SELECT COUNT(*) FROM source_changes sc
                WHERE sc.watch_source_id = ws.id
                  AND sc.detected_at > NOW() - INTERVAL '7 days'
                  AND sc.significance != 'noise'
              ), 0) AS recent_finding_count
         FROM watch_sources ws
        WHERE ws.project_id = ?
          AND ws.status != 'archived'
          AND ws.monitor_id IS NULL
        ORDER BY ws.created_at DESC`,
      projectId,
    ),
  ]);

  const monitorsAsWatchers: Watcher[] = monitors.map((m) => {
    const urls = Array.isArray(m.urls_to_track) ? m.urls_to_track : [];
    const cfg = (m.config || {}) as Record<string, unknown>;
    const keywords = Array.isArray(cfg.keywords) ? (cfg.keywords as string[]) : [];
    const competitorNames = Array.isArray(cfg.competitor_names)
      ? (cfg.competitor_names as string[])
      : [];
    return {
      id: `w_m_${m.id}`,
      project_id: m.project_id,
      name: m.name,
      topic: topicFromMonitorType(m.type),
      kind: urls.length > 0 ? 'hybrid' : 'scan',
      // Monitors always synthesize via LLM — that's their whole job.
      depth: 'deep',
      cadence: normalizeCadence(m.schedule),
      status: normalizeStatus(m.status),
      inputs: {
        urls: urls.length > 0 ? urls : undefined,
        keywords: keywords.length > 0 ? keywords : undefined,
        competitor_names: competitorNames.length > 0 ? competitorNames : undefined,
      },
      last_run_at: m.last_run,
      next_run_at: m.next_run,
      recent_finding_count: Number(m.recent_finding_count) || 0,
      created_at: m.created_at,
      _origin: 'monitor',
      _origin_id: m.id,
    };
  });

  const watchSourcesAsWatchers: Watcher[] = watchSources.map((ws) => ({
    id: `w_s_${ws.id}`,
    project_id: ws.project_id,
    name: ws.label,
    topic: topicFromWatchSourceCategory(ws.category),
    kind: 'diff',
    // Standalone watch sources just diff content — no synthesis layer.
    depth: 'pulse',
    cadence: normalizeCadence(ws.schedule),
    status: normalizeStatus(ws.status),
    inputs: { urls: [ws.url] },
    last_run_at: ws.last_scraped_at,
    next_run_at: ws.next_scrape_at,
    recent_finding_count: Number(ws.recent_finding_count) || 0,
    created_at: ws.created_at,
    _origin: 'watch_source',
    _origin_id: ws.id,
  }));

  // Merge + sort by recent activity, then by recency. Active first.
  const all = [...monitorsAsWatchers, ...watchSourcesAsWatchers];
  all.sort((a, b) => {
    if (a.status !== b.status) {
      if (a.status === 'active') return -1;
      if (b.status === 'active') return 1;
    }
    if (a.recent_finding_count !== b.recent_finding_count) {
      return b.recent_finding_count - a.recent_finding_count;
    }
    // postgres.js returns timestamps as Date objects, not strings.
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return all;
}

/**
 * Counts grouped by topic for the right-rail. Driven off listWatchers so
 * the topic mapping stays in one place.
 */
export async function watcherTopicCounts(projectId: string): Promise<Record<WatcherTopic, number>> {
  const watchers = await listWatchers(projectId);
  const counts: Record<string, number> = {};
  for (const w of watchers) {
    counts[w.topic] = (counts[w.topic] || 0) + 1;
  }
  return counts as Record<WatcherTopic, number>;
}

// =============================================================================
// Helpers
// =============================================================================

function normalizeCadence(raw: string): WatcherCadence {
  const v = (raw || '').toLowerCase();
  if (v === 'hourly' || v === 'daily' || v === 'weekly' || v === 'monthly' || v === 'manual') {
    return v;
  }
  return 'weekly';
}

function normalizeStatus(raw: string): WatcherStatus {
  const v = (raw || '').toLowerCase();
  if (v === 'active' || v === 'paused' || v === 'error' || v === 'archived') return v;
  return 'active';
}
