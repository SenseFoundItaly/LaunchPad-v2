import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import type { IntelligenceBrief } from '@/types';

/**
 * GET /api/projects/{projectId}/intelligence-briefs
 *
 * Query params:
 *   status  — filter by brief status (active | expired | superseded)
 *   entity  — filter by entity_name
 *   limit   — max results (default 20)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const entity = url.searchParams.get('entity');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10));

  const conditions: string[] = ['project_id = ?'];
  const values: unknown[] = [projectId];

  if (status) {
    conditions.push('status = ?');
    values.push(status);
  }
  if (entity) {
    conditions.push('entity_name = ?');
    values.push(entity);
  }

  values.push(limit);

  const briefs = await query<IntelligenceBrief>(
    `SELECT id, project_id, brief_type, entity_name, title, narrative,
            temporal_prediction, confidence, signal_ids, signal_count,
            recommended_actions, valid_until, status, created_at
     FROM intelligence_briefs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ?`,
    ...values,
  );

  // Parse JSONB fields
  const parsed = briefs.map(b => ({
    ...b,
    signal_ids: typeof b.signal_ids === 'string' ? JSON.parse(b.signal_ids) : b.signal_ids,
    recommended_actions: typeof b.recommended_actions === 'string' ? JSON.parse(b.recommended_actions) : b.recommended_actions,
  }));

  return json({ success: true, data: parsed });
}
