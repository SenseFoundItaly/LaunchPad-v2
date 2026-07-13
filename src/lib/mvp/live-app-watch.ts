// ============================================================================
// Live-app monitoring wire for the Build & Launch Hub.
//
// When a founder pastes the deployed MVP's live URL, register it as a
// `watch_source` so the EXISTING Firecrawl change-tracking pipeline produces
// `source_changes` — which the iteration proposer already reads as feedback.
// This closes the monitor → next-iteration side of the loop without any new
// scrape hook (Firecrawl's cron does the polling; the proposer does the read).
// ============================================================================

import { run, get } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';

/**
 * Ensure a `watch_source` exists for the project's live MVP URL and return its
 * id (existing or freshly-created). Idempotent per (project, url) — the route
 * enforces URL uniqueness, so re-PATCHing the same URL reuses the watcher.
 * Returns null for an invalid URL (caller leaves watch_source_id untouched).
 * Does NOT write the build row — the caller folds the id into its own update.
 */
export async function ensureLiveAppWatch(projectId: string, url: string): Promise<string | null> {
  try {
    new URL(url);
  } catch {
    return null;
  }

  const existing = await get<{ id: string }>(
    'SELECT id FROM watch_sources WHERE project_id = ? AND url = ? LIMIT 1',
    projectId,
    url,
  );
  if (existing) return existing.id;

  const id = generateId('ws');
  const now = new Date().toISOString();
  const schedule = 'weekly';
  const nextScrape = calculateNextRun(schedule) || now;
  await run(
    `INSERT INTO watch_sources
       (id, project_id, url, label, category, scrape_config, schedule,
        next_scrape_at, status, change_tracking_tag, monitor_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    id,
    projectId,
    url,
    'Live MVP',
    'custom',
    {}, // scrape_config JSONB — bound RAW (never JSON.stringify)
    schedule,
    nextScrape,
    `ws_${id}`,
    null,
    now,
    now,
  );
  return id;
}
