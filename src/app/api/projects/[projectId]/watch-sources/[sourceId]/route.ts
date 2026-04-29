import { NextRequest } from 'next/server';
import { query, run } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import type { WatchSource, SourceChange, WatchSourceCategory } from '@/types';
import { VALID_CATEGORIES } from '@/types';

/**
 * GET /api/projects/[projectId]/watch-sources/[sourceId]
 * Single source + last 10 changes.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string; sourceId: string }> },
) {
  const { projectId, sourceId } = await params;

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

  await run(
    'DELETE FROM watch_sources WHERE id = ? AND project_id = ?',
    sourceId, projectId,
  );

  return json({ deleted: true });
}
