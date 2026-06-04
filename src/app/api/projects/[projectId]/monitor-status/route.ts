import { NextRequest } from 'next/server';
import { query, get } from '@/lib/db';
import { json, error } from '@/lib/api-helpers';
import { tryProjectAccess } from '@/lib/auth/require-project-access';

interface MonitorRow {
  id: string;
  type: string;
  name: string;
}

interface AlertRow {
  headline: string;
  created_at: string;
}

/**
 * GET /api/projects/[projectId]/monitor-status?entity_id=...
 *
 * Returns whether a monitor is attached to the given entity (or risk) on
 * this project, plus the most recent firing — used by entity-card and
 * risk-matrix renderers to show a small "watching · last fired ..." chip
 * on the card itself, so signals are visible where the work is rather
 * than only in a separate alerts panel.
 *
 * Linkage strategy (in order):
 *   1. monitors.linked_risk_id = entity_id           — risk-matrix rows
 *   2. monitors.config->>'entity_id' = entity_id     — explicit linkage
 *   3. monitors.name ILIKE '%entity_id%'             — name fallback
 *      (entity-card passes its name when no stable id is available)
 *
 * Always returns 200 with { watching: boolean, ... }. The caller's UI is
 * fail-silent: a missing monitor or a fetch error should leave the card
 * unchanged.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const auth = await tryProjectAccess(projectId);
  if (!auth.ok) return auth.response;

  const entityId = request.nextUrl.searchParams.get('entity_id')?.trim();
  if (!entityId) return error('entity_id is required');

  // Find the monitor — exact match on linked_risk_id or config.entity_id
  // wins; name match is the loose fallback for entity-cards that don't
  // carry a stable persisted id at render time.
  const monitor = await get<MonitorRow>(
    `SELECT id, type, name
       FROM monitors
      WHERE project_id = ?
        AND status = 'active'
        AND (
          linked_risk_id = ?
          OR config->>'entity_id' = ?
          OR name ILIKE ?
        )
      ORDER BY
        CASE
          WHEN linked_risk_id = ? THEN 0
          WHEN config->>'entity_id' = ? THEN 1
          ELSE 2
        END,
        created_at DESC
      LIMIT 1`,
    projectId,
    entityId,
    entityId,
    `%${entityId}%`,
    entityId,
    entityId,
  );

  if (!monitor) {
    return json({ watching: false });
  }

  const lastAlert = await get<AlertRow>(
    `SELECT headline, created_at
       FROM ecosystem_alerts
      WHERE project_id = ? AND monitor_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    projectId,
    monitor.id,
  );

  return json({
    watching: true,
    monitor_id: monitor.id,
    monitor_type: monitor.type,
    last_fired_at: lastAlert?.created_at ?? null,
    last_headline: lastAlert?.headline ?? null,
  });
}
