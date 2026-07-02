import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { tryProjectAccess } from '@/lib/auth/require-project-access';
import { json, error } from '@/lib/api-helpers';
import type { WatchSource, SourceChange, WatchSourceCategory } from '@/types';
import { VALID_CATEGORIES } from '@/types';
import { processWatchSource } from '@/lib/watch-source-processor';

/**
 * GET /api/projects/[projectId]/watch-sources/[sourceId]
 * Single source + last 10 changes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  const { projectId, sourceId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const sources = await query<WatchSource>(
    'SELECT * FROM watch_sources WHERE id = ? AND project_id = ?',
    sourceId, projectId,
  );
  if (sources.length === 0) {
    return error('Watch source not found', 404);
  }

  const changes = await query<SourceChange>(
    `SELECT * FROM source_changes
     WHERE watch_source_id = ? AND project_id = ?
     ORDER BY detected_at DESC
     LIMIT 10`,
    sourceId, projectId,
  );

  return json({ source: sources[0], changes });
}

/**
 * PATCH /api/projects/[projectId]/watch-sources/[sourceId]
 * Update label, category, schedule, or status.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  const { projectId, sourceId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  let body: Partial<{
    label: string;
    category: string;
    schedule: string;
    status: string;
  }>;
  try {
    body = await request.json();
  } catch {
    return error('Invalid JSON body');
  }

  // Validate category
  if (body.category && !VALID_CATEGORIES.has(body.category as WatchSourceCategory)) {
    return error(`Invalid category: ${body.category}`);
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.label) { sets.push('label = ?'); values.push(body.label); }
  if (body.category) { sets.push('category = ?'); values.push(body.category); }
  if (body.schedule) { sets.push('schedule = ?'); values.push(body.schedule); }
  if (body.status) { sets.push('status = ?'); values.push(body.status); }

  if (sets.length === 0) {
    return error('No fields to update');
  }

  sets.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(sourceId, projectId);

  await run(
    `UPDATE watch_sources SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`,
    ...values,
  );

  const updated = await query<WatchSource>(
    'SELECT * FROM watch_sources WHERE id = ? AND project_id = ?',
    sourceId, projectId,
  );

  return json(updated[0]);
}

/**
 * DELETE /api/projects/[projectId]/watch-sources/[sourceId]
 * Remove a watch source and its changes (cascaded by FK).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  const { projectId, sourceId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  await run(
    'DELETE FROM watch_sources WHERE id = ? AND project_id = ?',
    sourceId, projectId,
  );

  return json({ deleted: true });
}

/**
 * POST /api/projects/[projectId]/watch-sources/[sourceId]
 * Manual "Scrape now" trigger — runs processWatchSource and returns the result.
 *
 * Folded here from the old .../[sourceId]/scrape leaf: a static segment under
 * two dynamic segments ([projectId]/[sourceId]/scrape) 404s at runtime on the
 * OpenNext/Netlify adapter despite a clean build (same footgun the monitor /run
 * verb hit). The action lives on the parent dynamic route so it resolves in prod.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  const { projectId, sourceId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const sources = await query<WatchSource>(
    'SELECT * FROM watch_sources WHERE id = ? AND project_id = ?',
    sourceId, projectId,
  );
  if (sources.length === 0) {
    return error('Watch source not found', 404);
  }

  try {
    const result = await processWatchSource(sources[0]);
    return json(result);
  } catch (err) {
    return error(`Scrape failed: ${(err as Error).message}`, 500);
  }
}
