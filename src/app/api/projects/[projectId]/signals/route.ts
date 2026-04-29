import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { json } from '@/lib/api-helpers';
import type { SignalTimelineEntry } from '@/types';

/**
 * GET /api/projects/[projectId]/signals
 * Unified timeline of ecosystem_alerts + source_changes, sorted chronologically.
 *
 * Query params:
 *   - type: filter by alert_type (e.g., competitor_activity)
 *   - significance: filter by significance level
 *   - source: 'monitor' | 'watch_source' | 'all' (default: 'all')
 *   - days: lookback period (default: 30)
 *   - limit: max results (default: 50)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const url = new URL(request.url);

  const typeFilter = url.searchParams.get('type');
  const significanceFilter = url.searchParams.get('significance');
  const sourceFilter = url.searchParams.get('source') || 'all';
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Build the UNION query for both signal types
  const parts: string[] = [];
  const allParams: unknown[] = [];

  // Part 1: ecosystem_alerts (from monitors)
  if (sourceFilter === 'all' || sourceFilter === 'monitor') {
    let alertWhere = 'ea.project_id = ? AND ea.created_at >= ?';
    allParams.push(projectId, cutoff);

    if (typeFilter) {
      alertWhere += ' AND ea.alert_type = ?';
      allParams.push(typeFilter);
    }
    if (significanceFilter) {
      // Map significance to relevance_score ranges
      const scoreMap: Record<string, [number, number]> = {
        high: [0.8, 1.0],
        medium: [0.6, 0.8],
        low: [0.3, 0.6],
        noise: [0, 0.3],
      };
      const range = scoreMap[significanceFilter];
      if (range) {
        alertWhere += ' AND ea.relevance_score >= ? AND ea.relevance_score < ?';
        allParams.push(range[0], range[1]);
      }
    }

    parts.push(`
      SELECT
        ea.id,
        'ecosystem_alert' AS type,
        ea.headline,
        ea.body,
        COALESCE(ea.source, 'monitor') AS source_label,
        ea.source_url,
        CASE
          WHEN ea.relevance_score >= 0.8 THEN 'high'
          WHEN ea.relevance_score >= 0.6 THEN 'medium'
          WHEN ea.relevance_score >= 0.3 THEN 'low'
          ELSE 'noise'
        END AS significance,
        ea.created_at AS timestamp,
        ea.alert_type,
        NULL AS change_status,
        NULL AS diff_preview
      FROM ecosystem_alerts ea
      WHERE ${alertWhere}
    `);
  }

  // Part 2: source_changes (from watch sources)
  if (sourceFilter === 'all' || sourceFilter === 'watch_source') {
    let changeWhere = 'sc.project_id = ? AND sc.detected_at >= ? AND sc.change_status != \'same\'';
    allParams.push(projectId, cutoff);

    if (significanceFilter) {
      changeWhere += ' AND sc.significance = ?';
      allParams.push(significanceFilter);
    }

    parts.push(`
      SELECT
        sc.id,
        'source_change' AS type,
        COALESCE(sc.diff_summary, 'Content changed') AS headline,
        sc.significance_rationale AS body,
        ws.label AS source_label,
        ws.url AS source_url,
        sc.significance,
        sc.detected_at AS timestamp,
        NULL AS alert_type,
        sc.change_status,
        LEFT(sc.raw_diff, 200) AS diff_preview
      FROM source_changes sc
      JOIN watch_sources ws ON ws.id = sc.watch_source_id
      WHERE ${changeWhere}
    `);
  }

  if (parts.length === 0) {
    return json([]);
  }

  const unionQuery = `
    SELECT * FROM (
      ${parts.join(' UNION ALL ')}
    ) signals
    ORDER BY timestamp DESC
    LIMIT ?
  `;
  allParams.push(limit);

  const signals = await query<SignalTimelineEntry>(unionQuery, ...allParams);

  return json(signals);
}
