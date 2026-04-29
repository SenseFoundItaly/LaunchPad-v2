import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error, generateId } from '@/lib/api-helpers';
import { calculateNextRun } from '@/lib/monitor-schedule';
import type { WatchSource, WatchSourceCategory } from '@/types';
import { VALID_CATEGORIES } from '@/types';

/**
 * GET /api/projects/[projectId]/watch-sources
 * List watch sources with computed last_change_at and total_changes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  const sources = await query<WatchSource & { last_change_at: string | null; total_changes: number }>(
    `SELECT ws.*,
       (SELECT MAX(detected_at) FROM source_changes sc WHERE sc.watch_source_id = ws.id) AS last_change_at,
       (SELECT COUNT(*)::int FROM source_changes sc WHERE sc.watch_source_id = ws.id AND sc.change_status != 'same') AS total_changes
     FROM watch_sources ws
     WHERE ws.project_id = ?
     ORDER BY ws.created_at DESC`,
    projectId,
  );

  return json(sources);
}

/**
 * POST /api/projects/[projectId]/watch-sources
 * Create a new watch source.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;

  let body: {
    url?: string;
    label?: string;
    category?: string;
    schedule?: string;
    monitor_id?: string;
    scrape_config?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  if (!body.url || typeof body.url !== 'string') {
    return error('url is required');
  }
  if (!body.label || typeof body.label !== 'string') {
    return error('label is required');
  }

  // Validate URL
  try {
    new URL(body.url);
  } catch {
    return error('Invalid URL format');
  }

  // Validate category
  if (body.category && !VALID_CATEGORIES.has(body.category as WatchSourceCategory)) {
    return error(`Invalid category: ${body.category}`);
  }

  // Check for duplicate
  const existing = await query<{ id: string }>(
    'SELECT id FROM watch_sources WHERE project_id = ? AND url = ?',
    projectId, body.url,
  );
  if (existing.length > 0) {
    return error('This URL is already being tracked', 409);
  }

  const id = generateId('ws');
  const now = new Date().toISOString();
  const schedule = body.schedule || 'daily';
  const nextScrape = calculateNextRun(schedule) || now;

  await run(
    `INSERT INTO watch_sources
       (id, project_id, url, label, category, scrape_config, schedule,
        next_scrape_at, status, change_tracking_tag, monitor_id,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
    id,
    projectId,
    body.url,
    body.label,
    body.category || 'custom',
    JSON.stringify(body.scrape_config || {}),
    schedule,
    nextScrape,
    `ws_${id}`,
    body.monitor_id || null,
    now,
    now,
  );

  const created = await query<WatchSource>(
    'SELECT * FROM watch_sources WHERE id = ?',
    id,
  );

  return json(created[0], 201);
}
