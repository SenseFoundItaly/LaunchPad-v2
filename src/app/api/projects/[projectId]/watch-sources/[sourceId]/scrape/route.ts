import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { processWatchSource } from '@/lib/watch-source-processor';
import type { WatchSource } from '@/types';

/**
 * POST /api/projects/[projectId]/watch-sources/[sourceId]/scrape
 * Manual "Scrape now" trigger. Returns the processing result directly.
 */
export async function POST(
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

  const ws = sources[0];

  try {
    const result = await processWatchSource(ws);
    return json(result);
  } catch (err) {
    return error(`Scrape failed: ${(err as Error).message}`, 500);
  }
}
