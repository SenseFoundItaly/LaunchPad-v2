import { NextRequest } from 'next/server';
import { run, query } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { calculateNextRun } from '@/lib/monitor-schedule';
import { logSignalActivity } from '@/lib/signal-activity-log';
import type { WatcherTopic, WatcherKind, WatcherDepth, WatcherCadence } from '@/lib/watchers';

/**
 * POST /api/projects/[projectId]/watchers/accept
 *
 * Persists a list of accepted proposals as real watchers. Routes by `kind`:
 *   - scan / hybrid → monitors table
 *   - diff          → watch_sources table (one row per URL)
 *
 * Returns the list of created rows so the page can refresh + jump to them.
 *
 * Body shape mirrors ProposedWatcher from src/lib/watcher-proposer.ts.
 */

interface AcceptItem {
  name: string;
  topic: WatcherTopic;
  kind: WatcherKind;
  depth: WatcherDepth;
  cadence: WatcherCadence;
  rationale?: string;
  inputs: {
    urls?: string[];
    keywords?: string[];
    competitor_names?: string[];
  };
}

interface CreatedRow {
  origin: 'monitor' | 'watch_source';
  origin_id: string;
  name: string;
  kind: WatcherKind;
}

const VALID_TOPICS: WatcherTopic[] = [
  'competitors', 'ip', 'trends', 'partnerships', 'hiring',
  'sentiment', 'funding', 'regulatory', 'pricing', 'custom',
];
const VALID_KINDS: WatcherKind[] = ['scan', 'diff', 'hybrid'];
const VALID_DEPTHS: WatcherDepth[] = ['pulse', 'deep'];
const VALID_CADENCES: WatcherCadence[] = ['daily', 'weekly', 'monthly'];

// Topic → monitor.type slug. Mirrors src/lib/watchers.ts mapping inverted.
const TOPIC_TO_MONITOR_TYPE: Record<WatcherTopic, string> = {
  competitors: 'ecosystem.competitors',
  ip: 'ecosystem.ip',
  trends: 'ecosystem.trends',
  partnerships: 'ecosystem.partnerships',
  hiring: 'ecosystem.hiring',
  sentiment: 'ecosystem.customer_sentiment',
  funding: 'ecosystem.competitors',     // no dedicated table type yet; bucket here
  regulatory: 'ecosystem.trends',       // bucket; refine once monitor.type adds 'regulatory'
  pricing: 'ecosystem.ads',
  custom: 'ecosystem.competitors',
};

// Topic → watch_source.category slug.
const TOPIC_TO_WATCH_CATEGORY: Record<WatcherTopic, string> = {
  competitors: 'competitor_product',
  ip: 'patent_database',
  trends: 'news',
  partnerships: 'news',
  hiring: 'careers_page',
  sentiment: 'social_feed',
  funding: 'news',
  regulatory: 'regulatory',
  pricing: 'competitor_pricing',
  custom: 'custom',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: { accepted?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  if (!Array.isArray(body.accepted) || body.accepted.length === 0) {
    return error('accepted must be a non-empty array of proposals');
  }
  if (body.accepted.length > 10) {
    return error('cannot accept more than 10 proposals in one call');
  }

  const items: AcceptItem[] = [];
  for (const raw of body.accepted) {
    const validated = validateItem(raw);
    if (validated) items.push(validated);
  }
  if (items.length === 0) {
    return error('No valid proposals in payload', 422);
  }

  const created: CreatedRow[] = [];
  const errors: Array<{ name: string; reason: string }> = [];

  for (const item of items) {
    try {
      if (item.kind === 'diff') {
        // One watch_source per URL (the table is keyed on project_id + url).
        const urls = item.inputs.urls || [];
        if (urls.length === 0) {
          errors.push({ name: item.name, reason: 'diff watcher with no urls' });
          continue;
        }
        for (const url of urls) {
          const id = await insertWatchSource(projectId, item, url);
          if (id) {
            created.push({ origin: 'watch_source', origin_id: id, name: item.name, kind: item.kind });
          }
        }
      } else {
        // scan or hybrid → one row in monitors table
        const id = await insertMonitor(projectId, item);
        if (id) {
          created.push({ origin: 'monitor', origin_id: id, name: item.name, kind: item.kind });
        }
      }
    } catch (err) {
      errors.push({ name: item.name, reason: (err as Error).message });
    }
  }

  return json({ created, errors });
}

// ---------------------------------------------------------------------------
// Insert helpers
// ---------------------------------------------------------------------------

async function insertMonitor(projectId: string, item: AcceptItem): Promise<string | null> {
  const id = generateId('mon');
  const now = new Date().toISOString();
  const nextRun = calculateNextRun(item.cadence) || now;
  const monitorType = TOPIC_TO_MONITOR_TYPE[item.topic];

  // Build a minimal seed prompt — the cron's `runMonitor()` swaps in
  // the full system prompt via buildSystemPromptString(). What we store
  // here is the *user* turn the agent receives each run.
  const prompt = buildMonitorPrompt(item);

  const config = {
    topic: item.topic,
    kind: item.kind,
    depth: item.depth,
    keywords: item.inputs.keywords || [],
    competitor_names: item.inputs.competitor_names || [],
    auto_seeded: true,
    rationale: item.rationale || null,
  };

  const urlsToTrack = item.kind === 'hybrid' && item.inputs.urls ? item.inputs.urls : null;

  await run(
    `INSERT INTO monitors (id, project_id, type, name, schedule, config, prompt,
                           status, next_run, urls_to_track, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    id,
    projectId,
    monitorType,
    item.name,
    item.cadence,
    JSON.stringify(config),
    prompt,
    nextRun,
    urlsToTrack ? JSON.stringify(urlsToTrack) : null,
    now,
  );

  logSignalActivity({
    project_id: projectId,
    event_type: 'watcher_accepted',
    entity_id: id,
    entity_type: 'monitor',
    headline: `Watcher accepted: ${item.name}`,
    metadata: { topic: item.topic, depth: item.depth, cadence: item.cadence, kind: item.kind },
  }).catch(() => { /* non-fatal */ });

  return id;
}

async function insertWatchSource(
  projectId: string,
  item: AcceptItem,
  url: string,
): Promise<string | null> {
  // Validate URL
  try { new URL(url); } catch { return null; }

  // Skip duplicates — watch_sources has a UNIQUE (project_id, url) index.
  const existing = await query<{ id: string }>(
    'SELECT id FROM watch_sources WHERE project_id = ? AND url = ?',
    projectId, url,
  );
  if (existing.length > 0) return null;

  const id = generateId('ws');
  const now = new Date().toISOString();
  const nextScrape = calculateNextRun(item.cadence) || now;
  const category = TOPIC_TO_WATCH_CATEGORY[item.topic];

  // For multi-URL diff watchers we append "(host)" to the label so the
  // founder can tell them apart in the right rail.
  let label = item.name;
  if ((item.inputs.urls || []).length > 1) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      label = `${item.name} · ${host}`;
    } catch { /* keep base label */ }
  }

  await run(
    `INSERT INTO watch_sources
       (id, project_id, url, label, category, scrape_config, schedule,
        next_scrape_at, status, change_tracking_tag,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    id,
    projectId,
    url,
    label,
    category,
    JSON.stringify({ auto_seeded: true, rationale: item.rationale || null }),
    item.cadence,
    nextScrape,
    `ws_${id}`,
    now,
    now,
  );

  logSignalActivity({
    project_id: projectId,
    event_type: 'watcher_accepted',
    entity_id: id,
    entity_type: 'watch_source',
    headline: `Watcher accepted: ${label}`,
    metadata: { topic: item.topic, cadence: item.cadence, kind: 'diff', url },
  }).catch(() => { /* non-fatal */ });

  return id;
}

function buildMonitorPrompt(item: AcceptItem): string {
  const keywordLine = item.inputs.keywords?.length
    ? `Keywords: ${item.inputs.keywords.join(', ')}`
    : '';
  const competitorLine = item.inputs.competitor_names?.length
    ? `Competitors: ${item.inputs.competitor_names.join(', ')}`
    : '';
  const urlLine = item.inputs.urls?.length
    ? `Anchor URLs (synthesize alongside web search): ${item.inputs.urls.join(', ')}`
    : '';

  return [
    `You are running a "${item.name}" watcher.`,
    `Topic: ${item.topic}. Depth: ${item.depth}. Cadence: ${item.cadence}.`,
    keywordLine,
    competitorLine,
    urlLine,
    `Find the most relevant new signals since your last run. Emit one`,
    `:::artifact{"type":"ecosystem_alert"} block per finding (see the system contract).`,
    item.rationale ? `Why this watcher exists: ${item.rationale}` : '',
  ].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------------------
// Per-item validation (defense-in-depth — proposer already validated once)
// ---------------------------------------------------------------------------

function validateItem(raw: unknown): AcceptItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const name = typeof o.name === 'string' ? o.name.trim().slice(0, 80) : '';
  if (!name) return null;

  if (!isOneOf(o.topic, VALID_TOPICS)) return null;
  if (!isOneOf(o.kind, VALID_KINDS)) return null;
  if (!isOneOf(o.depth, VALID_DEPTHS)) return null;
  if (!isOneOf(o.cadence, VALID_CADENCES)) return null;

  const inputsRaw = (o.inputs || {}) as Record<string, unknown>;
  const inputs: AcceptItem['inputs'] = {};
  if (Array.isArray(inputsRaw.urls)) {
    inputs.urls = inputsRaw.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 10);
  }
  if (Array.isArray(inputsRaw.keywords)) {
    inputs.keywords = inputsRaw.keywords.filter((k): k is string => typeof k === 'string').slice(0, 15);
  }
  if (Array.isArray(inputsRaw.competitor_names)) {
    inputs.competitor_names = inputsRaw.competitor_names.filter((c): c is string => typeof c === 'string').slice(0, 10);
  }

  const kind = o.kind as WatcherKind;
  if ((kind === 'diff' || kind === 'hybrid') && (!inputs.urls || inputs.urls.length === 0)) return null;
  if (kind === 'scan' && (!inputs.keywords || inputs.keywords.length === 0)
                     && (!inputs.competitor_names || inputs.competitor_names.length === 0)) return null;

  return {
    name,
    topic: o.topic as WatcherTopic,
    kind,
    depth: o.depth as WatcherDepth,
    cadence: o.cadence as WatcherCadence,
    rationale: typeof o.rationale === 'string' ? o.rationale.slice(0, 240) : undefined,
    inputs,
  };
}

function isOneOf<T extends string>(v: unknown, allowed: T[]): boolean {
  return typeof v === 'string' && (allowed as string[]).includes(v);
}
