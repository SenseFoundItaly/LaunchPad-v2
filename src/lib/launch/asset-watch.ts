/**
 * ensureAssetWatch — hook a published asset's live URL into the existing
 * watch_sources → Firecrawl → source_changes monitoring loop, so the measure
 * side of the launch pipeline rides infrastructure that already runs on cron.
 *
 * Self-contained on purpose: PR #218 ships an equivalent helper for MVP builds
 * (src/lib/mvp/live-app-watch.ts) but that branch isn't merged; when it lands,
 * fold the two into one (same table, same idempotency key). Dedup is by
 * (project_id, url) — republish to the same URL never duplicates the watch.
 *
 * Only http(s) URLs are watchable — the stub publisher's data: URLs are
 * skipped (nothing to scrape).
 */

import { query, run } from '@/lib/db';
import { generateId } from '@/lib/api-helpers';

export async function ensureAssetWatch(
  projectId: string,
  url: string,
  label: string,
): Promise<string | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const existing = await query<{ id: string }>(
      `SELECT id FROM watch_sources WHERE project_id = ? AND url = ? LIMIT 1`,
      projectId, url,
    );
    if (existing[0]) return existing[0].id;
    const id = generateId('ws');
    await run(
      `INSERT INTO watch_sources (id, project_id, url, label, category, schedule, status)
       VALUES (?, ?, ?, ?, 'custom', 'weekly', 'active')`,
      id, projectId, url, label.slice(0, 200),
    );
    return id;
  } catch (err) {
    // Watching is an enhancement, never a publish blocker.
    console.warn('[launch] ensureAssetWatch failed (non-fatal):', (err as Error).message);
    return null;
  }
}
